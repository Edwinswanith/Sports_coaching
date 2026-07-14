"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BottomSheet } from "../BottomSheet";
import { Icon } from "../ui";
import {
  cancelAssistantPlan,
  confirmAssistantPlan,
  executeDemoAction,
  getDemoState,
  newOperationId,
  resetDemoState,
  submitAssistantMessage,
  transcribeVoiceDemoAudio,
} from "../../lib/voice-demo/client";
import { ProgressView } from "./ProgressView";
import { CoachPlanner } from "./CoachPlanner";
import type {
  AssistantConversationContext,
  AssistantDebug,
  AssistantTurnResponse,
  DemoDay,
  DemoSession,
  DemoState,
  DemoToolCall,
  RecoveryModality,
  WellnessKey,
} from "../../lib/voice-demo/types";
import { getActiveDemoDay } from "../../lib/voice-demo/types";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type View = "today" | "progress" | "coach" | "lab";
type DemoUiState = DemoState & Pick<DemoDay, "wellness" | "hydration" | "sessions" | "recovery" | "readiness">;
type ConversationEntry = {
  id: string;
  userMessage: string;
  turn: AssistantTurnResponse | null;
  pending: boolean;
  error?: string;
};
type ManualAction =
  | { type: "wellness" }
  | { type: "water" }
  | { type: "training"; sessionId: string }
  | { type: "recovery" }
  | { type: "message" }
  | null;
type AssistantMode = "closed" | "voice" | "input";
type VoiceRecordStatus = "idle" | "listening" | "speaking" | "transcribing";

const DEMO_DATE = "Sunday, 12 July";
const MAX_RECORDING_MS = 12_000;
const VAD_START_THRESHOLD = 0.055;
const VAD_STOP_THRESHOLD = 0.026;
const VAD_SILENCE_MS = 900;

export function AthleteVoiceDemo() {
  const [view, setView] = useState<View>("today");
  const [draft, setDraft] = useState("");
  const [assistantTurn, setAssistantTurn] = useState<AssistantTurnResponse | null>(null);
  const [lastAssistantMessage, setLastAssistantMessage] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssistantConversationContext>({});
  const [demoState, setDemoState] = useState<DemoState | null>(null);
  const [manualAction, setManualAction] = useState<ManualAction>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("closed");
  const [voiceRecordStatus, setVoiceRecordStatus] = useState<VoiceRecordStatus>("idle");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const silenceStartedAtRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);

  useEffect(() => {
    let active = true;
    getDemoState()
      .then((state) => {
        if (active) setDemoState(state);
      })
      .catch((error: unknown) => {
        if (active) setNotice({ tone: "error", text: error instanceof Error ? error.message : "Unable to load the demo." });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      stopVoiceListening({ discard: true });
    },
    [],
  );

  const uiState = useMemo<DemoUiState | null>(() => {
    if (!demoState) return null;
    return { ...demoState, ...getActiveDemoDay(demoState) };
  }, [demoState]);

  const pageMeta = useMemo(() => {
    if (view === "progress") return { eyebrow: "Performance analytics", title: "30-day progress" };
    if (view === "coach") return { eyebrow: "Coach workspace", title: "Workout planner" };
    if (view === "lab") return { eyebrow: "Test laboratory", title: "Action trace" };
    return { eyebrow: "Athlete workspace", title: "Today" };
  }, [view]);

  function showPrompt(prompt: string) {
    setDraft(prompt);
    setAssistantMode("input");
    void sendAssistantMessage(prompt);
  }

  async function sendAssistantMessage(message: string, options: { autoConfirmPlan?: boolean } = {}) {
    const trimmed = message.trim();
    if (!trimmed || assistantBusy) return;
    setDraft("");
    setAssistantBusy(true);
    setLastAssistantMessage(trimmed);
    setAssistantTurn(null);
    setNotice(null);
    const entryId = crypto.randomUUID();
    setConversation((current) => [...current, { id: entryId, userMessage: trimmed, turn: null, pending: true }]);
    try {
      const turn = await submitAssistantMessage(trimmed, assistantContext);
      setAssistantContext(turn.context);
      setAssistantTurn(turn);
      setConversation((current) => current.map((entry) => entry.id === entryId ? { ...entry, turn, pending: false } : entry));
      if (options.autoConfirmPlan && turn.kind === "plan") {
        const completedTurn = await confirmAssistantPlan(turn.plan.id);
        setAssistantTurn(completedTurn);
        setConversation((current) => current.map((entry) => entry.id === entryId ? { ...entry, turn: completedTurn, pending: false } : entry));
        if (completedTurn.kind === "completed") {
          setDemoState(completedTurn.state);
          setNotice({ tone: "success", text: completedTurn.message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant could not interpret that request.";
      setConversation((current) => current.map((entry) => entry.id === entryId ? { ...entry, pending: false, error: message } : entry));
      setNotice({ tone: "error", text: message });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function startVoiceMode() {
    if (assistantBusy || assistantTurn?.kind === "plan") return;
    setAssistantMode("voice");
    await startVoiceListening();
  }

  async function toggleVoiceRecording() {
    if (voiceRecordStatus === "speaking") {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (voiceRecordStatus === "listening") {
      stopVoiceListening();
      return;
    }
    await startVoiceMode();
  }

  function activateInputMode() {
    stopVoiceListening({ discard: true });
    setAssistantMode("input");
  }

  function closeMobileAssistant() {
    stopVoiceListening({ discard: true });
    setAssistantMode("closed");
  }

  function stopVoiceListening(options: { discard?: boolean } = {}) {
    discardRecordingRef.current = Boolean(options.discard);
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    silenceStartedAtRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    } else {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;
      setVoiceRecordStatus("idle");
      setVoiceLevel(0);
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  async function startVoiceListening() {
    if (voiceRecordStatus !== "idle" || assistantBusy || assistantTurn?.kind === "plan") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice({ tone: "error", text: "This browser does not support microphone recording." });
      setAssistantMode("closed");
      return;
    }

    try {
      setNotice(null);
      discardRecordingRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      audioChunksRef.current = [];
      setVoiceRecordStatus("listening");
      setVoiceLevel(0.08);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceRecordStatus("idle");
        setAssistantMode("closed");
        setNotice({ tone: "error", text: "Recording failed. Check microphone permission and try again." });
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
        if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        void audioContext.close();
        audioContextRef.current = null;
        analyserRef.current = null;
        vadFrameRef.current = null;
        silenceStartedAtRef.current = null;
        const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          setVoiceRecordStatus("idle");
          setVoiceLevel(0);
          return;
        }
        if (!audio.size) {
          setVoiceRecordStatus("idle");
          setVoiceLevel(0);
          setNotice({ tone: "error", text: "No audio was captured. Try recording again." });
          return;
        }
        void transcribeAndSubmit(audio);
      };

      runVadLoop();
    } catch (error) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setVoiceRecordStatus("idle");
      setAssistantMode("closed");
      setNotice({
        tone: "error",
        text: error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was blocked."
          : "Unable to start microphone recording.",
      });
    }
  }

  function runVadLoop() {
    const analyser = analyserRef.current;
    const recorder = mediaRecorderRef.current;
    if (!analyser || !recorder) return;
    const samples = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      const level = Math.min(1, Math.max(0.04, rms * 5.8));
      setVoiceLevel(level);

      if (recorder.state === "inactive" && rms > VAD_START_THRESHOLD) {
        audioChunksRef.current = [];
        recorder.start();
        setVoiceRecordStatus("speaking");
        silenceStartedAtRef.current = null;
        recordingTimeoutRef.current = setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, MAX_RECORDING_MS);
      } else if (recorder.state === "recording") {
        if (rms < VAD_STOP_THRESHOLD) {
          silenceStartedAtRef.current ??= performance.now();
          if (performance.now() - silenceStartedAtRef.current > VAD_SILENCE_MS) recorder.stop();
        } else {
          silenceStartedAtRef.current = null;
          setVoiceRecordStatus("speaking");
        }
      }

      if (mediaRecorderRef.current === recorder && recorder.state !== "recording") {
        setVoiceRecordStatus((status) => status === "transcribing" ? status : "listening");
      }
      vadFrameRef.current = requestAnimationFrame(tick);
    };

    vadFrameRef.current = requestAnimationFrame(tick);
  }

  async function transcribeAndSubmit(audio: Blob) {
    setVoiceRecordStatus("transcribing");
    try {
      const transcript = await transcribeVoiceDemoAudio(audio);
      setDraft(transcript);
      await sendAssistantMessage(transcript, { autoConfirmPlan: true });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Voice transcription failed." });
    } finally {
      setVoiceRecordStatus("idle");
      setAssistantMode("closed");
      setVoiceLevel(0);
      discardRecordingRef.current = false;
    }
  }

  async function confirmCurrentPlan() {
    if (assistantTurn?.kind !== "plan" || assistantBusy) return;
    setAssistantBusy(true);
    setNotice(null);
    try {
      const turn = await confirmAssistantPlan(assistantTurn.plan.id);
      setAssistantTurn(turn);
      setConversation((current) => current.map((entry) =>
        entry.turn?.kind === "plan" && entry.turn.plan.id === assistantTurn.plan.id ? { ...entry, turn } : entry,
      ));
      if (turn.kind === "completed") {
        setDemoState(turn.state);
        setNotice({ tone: "success", text: turn.message });
      }
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The assistant plan could not be confirmed." });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function cancelCurrentPlan() {
    if (assistantTurn?.kind !== "plan" || assistantBusy) return;
    setAssistantBusy(true);
    setNotice(null);
    try {
      const turn = await cancelAssistantPlan(assistantTurn.plan.id);
      setAssistantTurn(turn);
      setConversation((current) => current.map((entry) =>
        entry.turn?.kind === "plan" && entry.turn.plan.id === assistantTurn.plan.id ? { ...entry, turn } : entry,
      ));
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The assistant plan could not be cancelled." });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function runManualAction(call: DemoToolCall) {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await executeDemoAction(call);
      setDemoState(outcome.state);
      setManualAction(null);
      setNotice({ tone: "success", text: outcome.result.message });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The action could not be completed." });
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    setNotice(null);
    try {
      setDemoState(await resetDemoState());
      setAssistantTurn(null);
      setLastAssistantMessage("");
      setConversation([]);
      setAssistantContext({});
      setDraft("");
      setNotice({ tone: "success", text: "Demo restored to the original athlete scenario." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The demo could not be reset." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-[100dvh] max-w-full overflow-x-clip bg-[#f3f6f2] text-ink"
      style={
        {
          "--accent-rgb": "15 118 86",
          "--accent-strong-rgb": "10 105 76",
          "--accent-ink-rgb": "255 255 255",
          "--accent-soft": "rgb(15 118 86 / 0.13)",
        } as React.CSSProperties
      }
    >
      <DemoHeader busy={busy} onReset={resetDemo} />

      {notice ? (
        <div className="pointer-events-none fixed inset-x-0 top-[76px] z-50 flex justify-center px-4">
          <div
            role="alert"
            className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-pop ${
              notice.tone === "success" ? "border-ok/20 bg-[#edf9f2] text-[#146b3a]" : "border-bad/20 bg-[#fff1f1] text-bad"
            }`}
          >
            <span>{notice.tone === "success" ? <Icon.check /> : <Icon.x />}</span>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification" className="pointer-events-auto ml-2 opacity-60 hover:opacity-100"><Icon.x /></button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-[1440px] gap-5 px-4 pb-28 pt-4 md:px-6 lg:grid-cols-[220px_minmax(0,1fr)_360px] lg:pb-8 lg:pt-6">
        <DemoSidebar view={view} state={uiState} onChange={setView} />

        <main className="min-w-0">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="label text-accent-strong">{pageMeta.eyebrow}</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-[-0.03em] text-ink">
                {pageMeta.title}
              </h1>
            </div>
            <p className="hidden text-sm text-ink-muted sm:block">{DEMO_DATE}</p>
          </div>

          {!uiState ? <DemoLoading /> : null}
          {uiState && view === "today" ? (
            <TodayView
              state={uiState}
              onOpenAssistant={activateInputMode}
              onPrompt={showPrompt}
              onManual={setManualAction}
            />
          ) : null}
          {demoState && view === "progress" ? <ProgressView state={demoState} /> : null}
          {demoState && view === "coach" ? <CoachPlanner state={demoState} onStateChange={setDemoState} /> : null}
          {demoState && view === "lab" ? <TestLaboratory state={demoState} turn={assistantTurn} message={lastAssistantMessage} /> : null}
        </main>

        <aside className="hidden min-w-0 lg:block">
          <div className="sticky top-24 h-[calc(100dvh-7.5rem)] max-h-[880px]">
            <AssistantPanel
              state={uiState}
              turn={assistantTurn}
              conversation={conversation}
              busy={assistantBusy}
              draft={draft}
              voiceRecordStatus={voiceRecordStatus}
              onDraftChange={setDraft}
              onPrompt={showPrompt}
              onSubmit={sendAssistantMessage}
              onToggleVoiceRecording={toggleVoiceRecording}
              onConfirm={confirmCurrentPlan}
              onCancel={cancelCurrentPlan}
            />
          </div>
        </aside>
      </div>

      <button
        type="button"
        onClick={() => void startVoiceMode()}
        aria-label="Open Apex Assist"
        className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-ink text-white shadow-hero ring-4 ring-white/80 transition hover:-translate-y-0.5 lg:hidden ${assistantMode === "input" ? "hidden" : ""}`}
      >
        <Icon.spark />
      </button>

      <MobileAssistantSurface
        mode={assistantMode}
        draft={draft}
        busy={assistantBusy}
        voiceStatus={voiceRecordStatus}
        voiceLevel={voiceLevel}
        onInputFocus={activateInputMode}
        onDraftChange={setDraft}
        onSubmit={(message) => sendAssistantMessage(message, { autoConfirmPlan: true })}
        onClose={closeMobileAssistant}
      />

      <MobileNav view={view} onChange={setView} onAssistant={activateInputMode} />

      <BottomSheet
        open={manualAction !== null}
        onClose={() => !busy && setManualAction(null)}
        title={manualAction ? <ManualSheetTitle action={manualAction} /> : null}
      >
        {manualAction && uiState ? (
          <ManualActionForm
            key={manualAction.type === "training" ? `${manualAction.type}-${manualAction.sessionId}` : manualAction.type}
            action={manualAction}
            state={uiState}
            busy={busy}
            onSubmit={runManualAction}
          />
        ) : null}
      </BottomSheet>
    </div>
  );
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function MobileAssistantSurface({
  mode,
  draft,
  busy,
  voiceStatus,
  voiceLevel,
  onInputFocus,
  onDraftChange,
  onSubmit,
  onClose,
}: {
  mode: AssistantMode;
  draft: string;
  busy: boolean;
  voiceStatus: VoiceRecordStatus;
  voiceLevel: number;
  onInputFocus: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const glowLevel = voiceStatus === "speaking" ? Math.max(0.45, voiceLevel) : voiceStatus === "transcribing" ? 0.32 : 0.18;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    void onSubmit(draft);
    onClose();
  }

  if (mode === "voice") {
    return (
      <div className="fixed inset-0 z-40 lg:hidden" aria-live="polite">
        <button type="button" aria-label="Close assistant" onClick={onClose} className="absolute inset-0 cursor-default" />
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: glowLevel,
            boxShadow: `inset 0 0 ${28 + voiceLevel * 54}px ${8 + voiceLevel * 18}px rgb(73 150 255 / 0.5), inset 0 0 ${52 + voiceLevel * 72}px ${14 + voiceLevel * 28}px rgb(214 75 255 / 0.22)`,
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mx-auto w-[90vw] max-w-md">
          <div className="rounded-[2rem] border border-white/70 bg-white/90 px-5 py-4 shadow-hero backdrop-blur-xl">
            <div className="mx-auto mb-3 h-1 w-16 rounded-full bg-black/20" />
            <div className="flex items-center justify-between gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef6ff] text-[#1a73e8]">
                <Icon.spark />
              </div>
              <VoiceWave level={voiceLevel} status={voiceStatus} />
              <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-inset text-ink">
                {voiceStatus === "transcribing" ? <Icon.spark /> : <Icon.mic />}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode !== "input") return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button type="button" aria-label="Close assistant" onClick={onClose} className="absolute inset-0 cursor-default" />
      <form
        onSubmit={submit}
        className="absolute inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mx-auto w-[90vw] max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={draft}
          disabled={busy}
          onFocus={onInputFocus}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Ask Apex"
          aria-label="Ask Apex"
          className="h-14 w-full rounded-full border border-line bg-white px-6 text-base text-ink shadow-hero outline-none transition placeholder:text-ink-faint focus:border-accent/40 focus:ring-4 focus:ring-accent/10 disabled:opacity-60"
        />
      </form>
    </div>
  );
}

function VoiceWave({ level, status }: { level: number; status: VoiceRecordStatus }) {
  const active = status === "speaking";
  const processing = status === "transcribing";
  const bars = Array.from({ length: 18 }, (_, index) => {
    const phase = index / 17;
    const wave = Math.sin((phase * Math.PI * 2) + level * 5);
    const height = processing
      ? 14 + Math.abs(Math.sin(phase * Math.PI * 3)) * 18
      : active
        ? 12 + Math.abs(wave) * 38 * Math.max(0.25, level)
        : 10 + Math.sin(phase * Math.PI) * 8;
    return height;
  });
  return (
    <div className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5">
      {bars.map((height, index) => (
        <span
          key={index}
          className={`w-1.5 rounded-full bg-gradient-to-t from-[#1a73e8] via-[#8b5cf6] to-[#ec4899] ${processing ? "animate-pulse" : ""}`}
          style={{
            height,
            opacity: active || processing ? 0.95 : 0.38,
            transform: active ? `scaleY(${1 + level * 0.35})` : undefined,
            transition: "height 80ms linear, opacity 160ms ease, transform 80ms linear",
          }}
        />
      ))}
    </div>
  );
}

function DemoHeader({ busy, onReset }: { busy: boolean; onReset: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-[#f8faf7]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] w-full max-w-[1440px] items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-white shadow-sm">
            <Icon.spark />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-display text-base font-bold tracking-[-0.02em]">Apex Assist</p>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-accent-strong">
                Demo
              </span>
            </div>
            <p className="text-[11px] text-ink-muted">Athlete reporting, without the admin work</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-muted sm:flex sm:items-center sm:gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            Synthetic data
          </div>
          <button type="button" onClick={onReset} disabled={busy} className="btn-ghost h-9 px-2.5 sm:px-3" aria-label="Reset demo data">
            <Icon.calendar /> <span className="hidden sm:inline">Reset demo</span>
          </button>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-orange-200 text-xs font-bold text-amber-950">
            AS
          </div>
        </div>
      </div>
    </header>
  );
}

function DemoSidebar({ view, state, onChange }: { view: View; state: DemoUiState | null; onChange: (view: View) => void }) {
  const completed = state ? completedDailyItems(state) : 1;
  const progress = completed * 20;
  const items: Array<{ key: View; label: string; helper: string; icon: ReactNode }> = [
    { key: "today", label: "Athlete today", helper: "Daily reporting", icon: <Icon.home /> },
    { key: "progress", label: "Progress", helper: "30-day analytics", icon: <Icon.pulse /> },
    { key: "coach", label: "Coach planner", helper: "Draft and publish", icon: <Icon.users /> },
    { key: "lab", label: "Test laboratory", helper: "System trace", icon: <Icon.pulse /> },
  ];

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 space-y-4">
        <div className="rounded-3xl border border-line bg-white p-3 shadow-raised">
          <nav aria-label="Demo views" className="space-y-1">
            {items.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => onChange(item.key)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                  view === item.key ? "bg-ink text-white shadow-sm" : "text-ink-muted hover:bg-surface-inset hover:text-ink"
                }`}
              >
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${view === item.key ? "bg-white/10" : "bg-surface-inset"}`}>
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={`block text-[10px] ${view === item.key ? "text-white/60" : "text-ink-faint"}`}>{item.helper}</span>
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="rounded-3xl bg-[#15382e] p-4 text-white shadow-raised">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Today</span>
            <span className="text-sm font-bold">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#75e3b8] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-3 text-sm font-semibold">{completed} of 5 complete</p>
          <p className="mt-1 text-xs leading-relaxed text-white/60">{5 - completed} quick updates remain for Aarav today.</p>
        </div>
      </div>
    </aside>
  );
}

function TodayView({
  state,
  onOpenAssistant,
  onPrompt,
  onManual,
}: {
  state: DemoUiState;
  onOpenAssistant: () => void;
  onPrompt: (prompt: string) => void;
  onManual: (action: ManualAction) => void;
}) {
  const wellness = (["sleepQuality", "mood", "soreness", "fatigue"] as WellnessKey[]).map((key) => ({
    key,
    label: wellnessLabel(key),
    value: state.wellness[key] === null ? "Missing" : `${state.wellness[key]} / 10`,
    done: state.wellness[key] !== null,
  }));
  const wellnessLogged = wellness.filter((item) => item.done).length;
  const completed = completedDailyItems(state);
  const remaining = 5 - completed;
  const hydrationPercent = Math.min(100, Math.round((state.hydration.totalMl / state.hydration.goalMl) * 100));
  const nextPlan = [...state.coachPlans]
    .filter((plan) => plan.status === "published" && plan.dateKey >= state.athlete.dateKey)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || b.version - a.version)[0];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#15382e] p-5 text-white shadow-hero sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full border-[42px] border-white/[0.04]" />
        <div className="relative grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-[#91dabc]">
              <Icon.sun />
              <span>Good morning, Aarav</span>
            </div>
            <h2 className="max-w-xl font-display text-[2rem] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[2.6rem]">
              Finish today&apos;s reporting in under a minute.
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/65">
              You have {remaining} item{remaining === 1 ? "" : "s"} left. Speak naturally, type a command, or use the manual controls.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button type="button" onClick={onOpenAssistant} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#15382e] transition hover:bg-[#effbf5]">
                <Icon.mic />
                Talk to Apex
              </button>
              <button type="button" onClick={() => onManual({ type: "wellness" })} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/10">
                Manual check-in
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur sm:block sm:w-40">
            <div
              className="relative grid h-20 w-20 place-items-center rounded-full sm:mx-auto sm:h-24 sm:w-24"
              style={{ background: `conic-gradient(#75e3b8 ${completed * 20}%, rgba(255,255,255,0.1) 0)` }}
            >
              <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-[#15382e] sm:h-[82px] sm:w-[82px]">
                <div className="text-center">
                  <p className="nums text-xl font-bold sm:text-2xl">{completed}/5</p>
                  <p className="text-[9px] uppercase tracking-widest text-white/50">done</p>
                </div>
              </div>
            </div>
            <div className="sm:mt-3 sm:text-center">
              <p className="text-sm font-semibold">Daily progress</p>
              <p className="mt-0.5 text-[11px] text-white/50">Updated 8:20 AM</p>
            </div>
          </div>
        </div>
      </section>

      {nextPlan ? (
        <section className="rounded-[1.6rem] border border-accent/20 bg-gradient-to-br from-white to-[#eef8f3] p-5 shadow-raised">
          <SectionHeader eyebrow="Published by Coach Priya" title={`${nextPlan.title} · ${nextPlan.dateKey}`} action={`Version ${nextPlan.version}`} />
          <p className="mt-2 text-xs text-ink-muted">{nextPlan.focus} · {nextPlan.durationMinutes} minutes. Draft revisions remain private until published.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {nextPlan.exercises.map((exercise) => (
              <article key={exercise.id} className="rounded-2xl border border-line bg-white p-3.5">
                <p className="text-sm font-bold text-ink">{exercise.name}</p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {exercise.reps !== undefined ? `${exercise.sets} × ${exercise.reps} reps` : `${exercise.sets} × ${exercise.distanceMeters} m`} · {exercise.loadKg} kg{exercise.loadLabel ? ` ${exercise.loadLabel}` : ""}
                </p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-accent-strong">Target RPE {exercise.targetRpe} · Rest {exercise.restSeconds}s</p>
              </article>
            ))}
          </div>
          <button type="button" onClick={() => onPrompt("What has Coach Priya planned for Monday?")} className="mt-4 text-sm font-bold text-accent-strong hover:underline">Ask about this plan →</button>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader
            eyebrow="Morning check-in"
            title={wellnessLogged === 4 ? "All signals are logged" : `${4 - wellnessLogged} signal${4 - wellnessLogged === 1 ? " is" : "s are"} missing`}
            action={`${wellnessLogged} of 4 logged`}
          />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {wellness.map((item) => (
              <div key={item.label} className={`rounded-2xl border p-3.5 ${item.done ? "border-accent/20 bg-accent/[0.06]" : "border-dashed border-line-strong bg-surface-inset/60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-muted">{item.label}</p>
                  <span className={`h-2 w-2 rounded-full ${item.done ? "bg-ok" : "bg-warn"}`} />
                </div>
                <p className={`nums mt-2 text-base font-bold ${item.done ? "text-ink" : "text-ink-faint"}`}>{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onManual({ type: "wellness" })} className="btn-secondary">Manual entry</button>
            <button type="button" onClick={() => onPrompt("My sleep quality was eight")} className="btn-primary"><Icon.mic /> Use assistant</button>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader eyebrow="Hydration" title={`${state.hydration.totalMl.toLocaleString("en-IN")} ml logged`} action={`${hydrationPercent}% of goal`} />
          <div className="mt-6 flex items-center gap-5">
            <div className="relative h-32 w-20 overflow-hidden rounded-[1.7rem] border-4 border-[#dce8e2] bg-[#f6faf8]">
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#55b9de] to-[#9adcf4] transition-all" style={{ height: `${hydrationPercent}%` }} />
              <div className="absolute inset-0 grid place-items-center">
                <Icon.water />
              </div>
            </div>
            <div className="flex-1">
              <p className="nums text-3xl font-bold tracking-[-0.04em] text-ink">{state.hydration.totalMl.toLocaleString("en-IN")} <span className="text-base font-semibold text-ink-muted">ml</span></p>
              <p className="mt-1 text-sm text-ink-muted">of {state.hydration.goalMl.toLocaleString("en-IN")} ml daily goal</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-inset">
                <div className="h-full rounded-full bg-[#55b9de] transition-all" style={{ width: `${hydrationPercent}%` }} />
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
                <button type="button" onClick={() => onManual({ type: "water" })} className="text-accent-strong hover:underline">+ Manual log</button>
                <button type="button" onClick={() => onPrompt("Add 250 ml of water")} className="text-ink-muted hover:text-accent-strong">Use assistant</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
        <SectionHeader
          eyebrow="Training plan"
          title="Two sessions scheduled"
          action={`${state.sessions.filter((session) => session.status === "planned").length} pending`}
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {state.sessions.map((session) => (
            <article key={session.id} className="group rounded-2xl border border-line bg-[#fafbf9] p-4 transition hover:-translate-y-0.5 hover:border-accent/25 hover:shadow-raised">
              <div className="flex items-start justify-between gap-3">
                <div className={`grid h-10 w-10 place-items-center rounded-xl ${session.slot === "morning" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  <Icon.dumbbell />
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${session.status === "completed" ? "bg-ok/10 text-ok" : session.status === "planned" ? "bg-warn/10 text-warn" : "bg-surface-inset text-ink-muted"}`}>{session.status === "planned" ? "Pending" : session.status}</span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-faint">{capitalize(session.slot)} · {session.time}</p>
                  <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-ink">{session.title}</h3>
                  <p className="mt-1 text-xs text-ink-muted">{sessionActualDetail(session)}</p>
                </div>
                <button type="button" onClick={() => onManual({ type: "training", sessionId: session.id })} aria-label={`Log ${session.title}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink-muted transition group-hover:border-accent/30 group-hover:text-accent-strong">
                  <Icon.chevron />
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-4 flex gap-2 rounded-2xl border border-warn/20 bg-warn/[0.06] px-4 py-3 text-xs leading-relaxed text-ink-muted">
          <span className="mt-0.5 text-warn"><Icon.spark /></span>
          <p>
            {state.sessions.filter((session) => session.status === "planned").length > 1
              ? "Because two sessions are incomplete, “I completed training” should ask which session—never guess."
              : state.sessions.filter((session) => session.status === "planned").length === 1
                ? "Only Morning Conditioning remains, so the assistant can resolve “I completed training” to that session and show it for confirmation."
                : "Both sessions have an athlete-reported outcome for today."}
          </p>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <MiniCard icon={<Icon.heart />} eyebrow="Recovery" title={state.recovery.modalities.length ? state.recovery.modalities.join(" · ") : "Not logged yet"} detail="Stretching, mobility, ice bath or physio" cta="Log recovery" onClick={() => onManual({ type: "recovery" })} />
        <MiniCard icon={<Icon.message />} eyebrow={state.coach.name} title="Focus on clean form" detail={state.coach.latestGuidance} cta="Reply to coach" onClick={() => onManual({ type: "message" })} />
      </section>
    </div>
  );
}

function AssistantPanel({
  compact = false,
  state,
  turn,
  conversation,
  busy,
  draft,
  voiceRecordStatus,
  onDraftChange,
  onPrompt,
  onSubmit,
  onToggleVoiceRecording,
  onConfirm,
  onCancel,
}: {
  compact?: boolean;
  state: DemoUiState | null;
  turn: AssistantTurnResponse | null;
  conversation: ConversationEntry[];
  busy: boolean;
  draft: string;
  voiceRecordStatus: VoiceRecordStatus;
  onDraftChange: (value: string) => void;
  onPrompt: (prompt: string) => void;
  onSubmit: (message: string) => Promise<void>;
  onToggleVoiceRecording: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const pendingChips = state ? missingDemoItems(state) : ["Sleep", "Soreness", "Fatigue", "2 sessions"];
  const historyRef = useRef<HTMLDivElement>(null);
  const hasOpenPlan = turn?.kind === "plan";
  const micDisabled = busy || hasOpenPlan || voiceRecordStatus === "transcribing";
  const micLabel = voiceRecordStatus === "speaking"
    ? "Stop recording"
    : voiceRecordStatus === "listening"
      ? "Stop listening"
    : voiceRecordStatus === "transcribing"
      ? "Transcribing voice command"
      : "Record voice command";

  useEffect(() => {
    const element = historyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation, busy]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(draft);
  }

  return (
    <section
      data-testid="assistant-panel"
      className={`${compact
        ? "flex h-[calc(88dvh-5.75rem)] min-h-0 max-h-[720px] flex-col"
        : "flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-line bg-white shadow-hero"}`}
    >
      {!compact ? (
        <div className="shrink-0 border-b border-line bg-gradient-to-br from-[#15382e] to-[#1d4e40] p-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10"><Icon.spark /></div>
              <div>
                <h2 className="font-bold">Apex Assist</h2>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/60"><span className="h-1.5 w-1.5 rounded-full bg-[#75e3b8]" /> Ready for a command</div>
              </div>
            </div>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/70">Voice enabled</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-white/70">Ask about your progress or tell me what you completed. I’ll ground insights in your records and preview every update.</p>
        </div>
      ) : null}

      <div className={`flex min-h-0 flex-1 flex-col ${compact ? "" : "p-4"}`}>
        <div className="mb-3 shrink-0 rounded-2xl border border-accent/15 bg-accent/[0.055] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-strong">Still needed today</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pendingChips.length ? pendingChips.map((item) => <span key={item} className="rounded-full border border-accent/15 bg-white px-2.5 py-1 text-[10px] font-semibold text-ink-muted">{item}</span>) : <span className="text-xs font-semibold text-ok">Everything is complete</span>}
          </div>
        </div>

        {!conversation.length ? (
          <div className="grid min-h-0 flex-1 place-content-center py-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#15382e] text-white shadow-raised"><Icon.chat /></div>
            <h3 className="mt-4 font-bold text-ink">What would you like to review or update?</h3>
            <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-ink-muted">Ask about patterns in your history, or log today’s work in your own words.</p>
          </div>
        ) : null}

        {conversation.length ? (
          <div className="mb-3 flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">Conversation</p>
              <p className="text-[9px] text-ink-faint">{conversation.length} turn{conversation.length === 1 ? "" : "s"} · scroll for history</p>
            </div>
            <div
              ref={historyRef}
              data-testid="assistant-conversation-history"
              aria-live="polite"
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-[#fafbf9] p-3 pr-2 [scrollbar-gutter:stable]"
            >
              {conversation.map((entry) => (
                <div key={entry.id} data-conversation-entry={entry.id} className="space-y-2">
                  <div className="ml-8 rounded-2xl rounded-br-md bg-ink p-3.5 text-sm text-white">{entry.userMessage}</div>
                  <ConversationTurn
                    entry={entry}
                    currentPlanId={turn?.kind === "plan" ? turn.plan.id : undefined}
                    busy={busy}
                    onDraftChange={onDraftChange}
                    onPrompt={onPrompt}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div data-testid="assistant-composer" className="mt-auto shrink-0 border-t border-line bg-white pt-3">
          {!conversation.length ? (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {["What stands out in my data?", "Which day was difficult?", "What is left today?", "Add 250 ml water", "I completed evening strength"].map((prompt) => (
                <button type="button" key={prompt} disabled={busy || hasOpenPlan} onClick={() => onPrompt(prompt)} className="shrink-0 rounded-full border border-line bg-surface-inset px-3 py-2 text-[10px] font-semibold text-ink-muted transition hover:border-accent/30 hover:text-accent-strong disabled:opacity-40">
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mb-1.5 flex items-center justify-between px-1">
            <label htmlFor={compact ? "assistant-input-mobile" : "assistant-input-desktop"} className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">Message Apex</label>
            <span className="text-[9px] text-ink-faint">Enter to send</span>
          </div>
          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border-2 border-accent/25 bg-surface-inset p-2 shadow-sm focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
            <input id={compact ? "assistant-input-mobile" : "assistant-input-desktop"} value={voiceRecordStatus === "listening" ? "Listening..." : voiceRecordStatus === "speaking" ? "Recording..." : draft} disabled={hasOpenPlan || voiceRecordStatus !== "idle"} onChange={(event) => onDraftChange(event.target.value)} placeholder={hasOpenPlan ? "Confirm or cancel the proposed update" : "Ask a question or log an update..."} aria-label="Message Apex" className="min-w-0 flex-1 bg-transparent px-2 text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed" />
            <button type="submit" disabled={busy || hasOpenPlan || !draft.trim()} aria-label="Send text command" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white transition hover:bg-accent-strong disabled:opacity-40"><Icon.chevron /></button>
            <button
              type="button"
              disabled={micDisabled}
              onClick={() => void onToggleVoiceRecording()}
              aria-label={micLabel}
              title={micLabel}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white transition disabled:opacity-40 ${
                voiceRecordStatus === "speaking" ? "bg-bad shadow-[0_0_0_4px_rgb(239_68_68_/_0.12)]" : voiceRecordStatus === "listening" ? "bg-[#1a73e8] shadow-[0_0_0_4px_rgb(26_115_232_/_0.14)]" : "bg-accent hover:bg-accent-strong"
              }`}
            >
              {voiceRecordStatus === "transcribing" ? <Icon.spark /> : <Icon.mic />}
            </button>
          </form>
          <p className="mt-2 text-center text-[10px] text-ink-faint">
            {voiceRecordStatus === "listening" ? "Listening. Start speaking to record." : voiceRecordStatus === "speaking" ? "Recording. I will stop after you finish speaking." : voiceRecordStatus === "transcribing" ? "Transcribing voice command..." : "Your data changes only after you review and confirm."}
          </p>
        </div>
      </div>
    </section>
  );
}

function ConversationTurn({
  entry,
  currentPlanId,
  busy,
  onDraftChange,
  onPrompt,
  onConfirm,
  onCancel,
}: {
  entry: ConversationEntry;
  currentPlanId?: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onPrompt: (value: string) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  if (entry.pending) {
    return (
      <div className="mr-8 rounded-2xl rounded-bl-md bg-surface-inset p-3.5 text-sm text-ink-muted">
        <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Interpreting and validating…</div>
      </div>
    );
  }
  if (entry.error) {
    return <div className="mr-8 rounded-2xl rounded-bl-md border border-bad/15 bg-bad/[0.06] p-3.5 text-sm font-semibold text-ink">{entry.error}</div>;
  }
  const turn = entry.turn;
  if (!turn) return null;

  if (turn.kind === "plan") {
    const active = turn.plan.id === currentPlanId;
    return (
      <div className="rounded-2xl border border-accent/20 bg-white p-4 shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-strong">Proposed update</p>
          <span className="rounded-full bg-warn/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-warn">Needs confirmation</span>
        </div>
        <h3 className="mt-3 font-bold text-ink">{turn.plan.summary}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {turn.plan.displayFields.map((field) => <PlanValue key={`${field.label}-${field.value}`} label={field.label} value={field.value} />)}
        </dl>
        {active ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void onCancel()} disabled={busy} className="btn-secondary">Cancel</button>
            <button type="button" onClick={() => void onConfirm()} disabled={busy} className="btn-primary">Confirm</button>
          </div>
        ) : null}
        <p className="mt-2 text-center text-[10px] text-ink-faint">Nothing changes until you confirm.</p>
      </div>
    );
  }

  return (
    <div className={`mr-8 rounded-2xl rounded-bl-md p-3.5 text-sm ${turn.kind === "unsupported" ? "border border-bad/15 bg-bad/[0.06] text-ink" : turn.kind === "completed" ? "border border-ok/15 bg-ok/[0.07] text-ink" : "bg-surface-inset text-ink"}`}>
      <p className="font-semibold">{turn.message}</p>
      {"evidence" in turn && turn.evidence?.length ? (
        <dl className="mt-3 grid gap-1.5">
          {turn.evidence.map((item, index) => (
            <div key={`${item.label}-${item.dateKey ?? "none"}-${index}`} className="rounded-xl border border-black/[0.05] bg-white/80 px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">{item.label}{item.dateKey ? ` · ${item.dateKey}` : ""}</dt>
              <dd className="mt-0.5 text-[11px] font-semibold leading-relaxed text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {turn.kind === "clarification" && turn.options?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {turn.options.map((option) => <button type="button" onClick={() => onDraftChange(option)} key={option} className="rounded-full border border-line bg-white px-2.5 py-1 text-[10px] font-semibold text-ink-muted">{option}</button>)}
        </div>
      ) : null}
      {"suggestions" in turn && turn.suggestions?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {turn.suggestions.map((suggestion) => (
            <button type="button" onClick={() => onPrompt(suggestion)} key={suggestion} className="rounded-full border border-accent/15 bg-white px-2.5 py-1 text-left text-[10px] font-semibold text-accent-strong hover:border-accent/40">
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CoachPreview({ state }: { state: DemoUiState }) {
  const pendingWellness = (["sleepQuality", "mood", "soreness", "fatigue"] as WellnessKey[])
    .filter((key) => state.wellness[key] === null)
    .map(wellnessLabel);
  const incompleteSessions = state.sessions.filter((session) => session.status === "planned");
  const latestAthleteMessage = [...state.coach.messages].reverse().find((message) => message.sender === "athlete");

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] bg-[#173e34] p-6 text-white shadow-hero">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8ad8b7]">Coach Priya · assigned athlete</p>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-[-0.04em]">{state.athlete.name}</h2>
            <p className="mt-1 text-sm text-white/60">{state.athlete.sport} · {state.athlete.squad}</p>
          </div>
          <div className="flex gap-2">
            <CoachMetric value={`${completedDailyItems(state)}/5`} label="Updates" />
            <CoachMetric value={String(state.hydration.totalMl)} label="Water ml" />
            <CoachMetric value={String(incompleteSessions.length)} label="Sessions left" />
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader eyebrow="Attention" title="Incomplete athlete reporting" action="Today" />
          <div className="mt-4 space-y-2.5">
            {pendingWellness.length ? (
              <div className="flex items-center gap-3 rounded-2xl bg-surface-inset p-3.5">
                <span className="h-2.5 w-2.5 rounded-full bg-warn" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">Morning wellness</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{joinDisplayList(pendingWellness)} missing</p>
                </div>
                <Icon.chevron />
              </div>
            ) : null}
            {incompleteSessions.map((session) => (
              <div key={session.id} className="flex items-center gap-3 rounded-2xl bg-surface-inset p-3.5">
                <span className="h-2.5 w-2.5 rounded-full bg-warn" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{capitalize(session.slot)} {session.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">Planned for {session.time}</p>
                </div>
                <Icon.chevron />
              </div>
            ))}
            {!pendingWellness.length && !incompleteSessions.length ? (
              <div className="rounded-2xl bg-ok/10 p-4 text-sm font-semibold text-ok">All required athlete updates are complete.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader eyebrow="Conversation" title="Latest message" action="8:05 AM" />
          <div className={`mt-5 rounded-2xl p-4 text-sm leading-relaxed ${latestAthleteMessage ? "ml-8 rounded-tr-md bg-accent/10 text-ink" : "rounded-tl-md bg-[#173e34] text-white"}`}>
            {latestAthleteMessage?.body ?? state.coach.latestGuidance}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">{latestAthleteMessage ? `Sent by ${state.athlete.name} through the shared demo tool.` : `When ${state.athlete.name} sends a manual or confirmed assistant reply, it will appear here.`}</p>
          <button type="button" className="btn-secondary mt-5 w-full"><Icon.message /> Open conversation</button>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
        <SectionHeader eyebrow="Shared outcome" title="What the coach should receive" action="After confirmation" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <OutcomeStep number="01" title="Exact session" detail="Evening Strength, never a guessed AM fallback." />
          <OutcomeStep number="02" title="Actual values" detail="Only sets, reps and effort the athlete stated." />
          <OutcomeStep number="03" title="Audit trail" detail="A verified update with source and confirmation." />
        </div>
      </section>
    </div>
  );
}

function TestLaboratory({ state, turn, message }: { state: DemoState; turn: AssistantTurnResponse | null; message: string }) {
  const debug = turn && "debug" in turn ? turn.debug : undefined;
  const steps = [
    ["01", "Audio capture", "Browser microphone", "Active"],
    ["02", "Speech to text", "Deepgram prerecorded API", "Active"],
    ["03", "Transcript input", "Editable athlete command", "Active"],
    ["04", "Tool proposal", "Gemini constrained function call", "Active"],
    ["05", "Validation", "Deterministic schemas and entity resolution", "Active"],
    ["06", "Confirmation", "Exact update shown before execution", "Active"],
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] bg-[#111b18] p-6 text-white shadow-hero">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#78d8b0]">Diagnostic workspace</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.04em]">See exactly where an assistant request succeeds or fails.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">This view separates transcription, interpretation, validation and execution so a wrong action is diagnosable.</p>
          </div>
          <span className="self-start rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">Voice assistant active</span>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
        <SectionHeader eyebrow="Request pipeline" title="Six observable checkpoints" action="Gemini connected" />
        <div className="mt-5 divide-y divide-line">
          {steps.map(([number, title, detail, status]) => (
            <div key={number} className="grid gap-3 py-4 sm:grid-cols-[48px_1fr_auto] sm:items-center">
              <span className="nums text-xs font-bold text-ink-faint">{number}</span>
              <div>
                <p className="text-sm font-bold text-ink">{title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
              </div>
              <span className={`w-fit rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${status === "Active" ? "bg-ok/10 text-ok" : "bg-surface-inset text-ink-faint"}`}>{status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader eyebrow="Latest trace" title={turn ? capitalize(turn.kind) : "No command yet"} action={debug?.provider ?? "Waiting"} />
          <dl className="mt-4 space-y-3">
            <TraceValue label="Text command" value={message || "Submit a text command from Apex Assist."} />
            <TraceValue label="Candidate tool" value={debug?.candidateTools.join(", ") || "—"} mono />
            <TraceValue label="Normalized query" value={debug?.normalizedQuery || "—"} mono />
            <TraceValue label="Date range" value={debug?.dateRange ? `${debug.dateRange.start} → ${debug.dateRange.end}` : "—"} mono />
            <TraceValue label="Metric" value={debug?.metric || "—"} mono />
            <TraceValue label="Analytics query" value={debug?.analysisQuery ? JSON.stringify(debug.analysisQuery) : "—"} mono />
            <TraceValue
              label="Analysis coverage"
              value={debug?.analysisCoverage
                ? `${debug.analysisCoverage.recordedDays} days · ${debug.analysisCoverage.missingObservations} missing${debug.analysisCoverage.pairedObservations !== undefined ? ` · ${debug.analysisCoverage.pairedObservations} paired` : ""}`
                : "—"}
            />
            <TraceValue label="Conversation context" value={debug?.context ? JSON.stringify(debug.context) : "{}"} mono />
            <TraceValue label="Evidence records" value={debug?.evidence ? String(debug.evidence.length) : "0"} />
            <TraceValue label="Grounding facts" value={debug?.groundingFacts ? String(debug.groundingFacts.length) : "0"} />
            <TraceValue label="Safety decision" value={debug?.safetyDecision || "—"} />
            <TraceValue label="Provider / model" value={debug ? `${debug.provider}${debug.model ? ` · ${debug.model}` : ""}` : "—"} mono />
            <TraceValue label="Interpretation latency" value={debug ? `${debug.latencyMs} ms` : "—"} />
            <TraceValue label="Response humanizer" value={debug?.humanizer ? `${debug.humanizer}${debug.humanizerLatencyMs !== undefined ? ` · ${debug.humanizerLatencyMs} ms` : ""}` : "—"} />
          </dl>
        </div>
        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <SectionHeader eyebrow="Environment" title="Provider readiness" action="Local only" />
          <div className="mt-4 space-y-3">
            <ProviderRow name="Deepgram" variable="DEEP_GRAM" status="Active" positive />
            <ProviderRow name="Gemini" variable={debug?.model ?? "Server-side key"} status="Active" positive />
            <ProviderRow name="Local demo store" variable={`${state.operations.length} operation${state.operations.length === 1 ? "" : "s"} recorded`} status="Connected" positive />
          </div>
          <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface-inset/60 p-3 text-[11px] leading-relaxed text-ink-muted">
            API keys will be read server-side only. They will never use a <code className="font-mono text-ink">NEXT_PUBLIC_</code> variable or appear in the browser bundle.
          </div>
        </div>
      </section>
    </div>
  );
}

function MobileNav({ view, onChange, onAssistant }: { view: View; onChange: (view: View) => void; onAssistant: () => void }) {
  const items: Array<{ key: View | "assistant"; label: string; icon: ReactNode }> = [
    { key: "today", label: "Today", icon: <Icon.home /> },
    { key: "progress", label: "Progress", icon: <Icon.pulse /> },
    { key: "assistant", label: "Assist", icon: <Icon.mic /> },
    { key: "coach", label: "Coach", icon: <Icon.users /> },
    { key: "lab", label: "Lab", icon: <Icon.pulse /> },
  ];

  return (
    <nav aria-label="Demo navigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
      <ul className="mx-auto flex max-w-md">
        {items.map((item) => {
          const active = item.key === view;
          return (
            <li key={item.key} className="flex flex-1">
              <button type="button" onClick={() => item.key === "assistant" ? onAssistant() : onChange(item.key)} className={`tab-item ${active ? "tab-item--active" : ""}`} aria-current={active ? "page" : undefined}>
                <span className={`grid h-7 w-12 place-items-center rounded-lg ${active ? "bg-accent-soft" : ""}`}>{item.icon}</span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ManualSheetTitle({ action }: { action: Exclude<ManualAction, null> }) {
  const title =
    action.type === "wellness"
      ? "Manual wellness check-in"
      : action.type === "water"
        ? "Log water"
        : action.type === "training"
          ? "Update training"
          : action.type === "recovery"
            ? "Log recovery"
            : "Message Coach Priya";
  return (
    <div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="text-[11px] text-ink-muted">Saved through the shared local demo tools</p>
    </div>
  );
}

function ManualActionForm({
  action,
  state,
  busy,
  onSubmit,
}: {
  action: Exclude<ManualAction, null>;
  state: DemoUiState;
  busy: boolean;
  onSubmit: (call: DemoToolCall) => Promise<void>;
}) {
  const [waterAmount, setWaterAmount] = useState("250");
  const [wellnessValues, setWellnessValues] = useState<Record<WellnessKey, string>>({
    sleepQuality: "",
    mood: "",
    soreness: "",
    fatigue: "",
  });
  const session = action.type === "training" ? state.sessions.find((candidate) => candidate.id === action.sessionId) : undefined;
  const [trainingStatus, setTrainingStatus] = useState<"completed" | "partial" | "skipped">("completed");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [effort, setEffort] = useState("");
  const [recovery, setRecovery] = useState<RecoveryModality[]>(state.recovery.modalities);
  const [messageBody, setMessageBody] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operationId = newOperationId();

    if (action.type === "water") {
      await onSubmit({ operationId, tool: "add_water", arguments: { amountMl: Number(waterAmount) } });
      return;
    }
    if (action.type === "wellness") {
      const values: Partial<Record<WellnessKey, number>> = {};
      for (const key of Object.keys(wellnessValues) as WellnessKey[]) {
        if (wellnessValues[key] !== "") values[key] = Number(wellnessValues[key]);
      }
      await onSubmit({ operationId, tool: "record_wellness", arguments: values });
      return;
    }
    if (action.type === "training") {
      const actuals = {
        ...(sets ? { sets: Number(sets) } : {}),
        ...(reps ? { reps: Number(reps) } : {}),
        ...(effort ? { effort: Number(effort) } : {}),
      };
      await onSubmit({
        operationId,
        tool: "update_training_session",
        arguments: { sessionId: action.sessionId, status: trainingStatus, ...actuals },
      });
      return;
    }
    if (action.type === "recovery") {
      await onSubmit({ operationId, tool: "record_recovery", arguments: { modalities: recovery } });
      return;
    }
    await onSubmit({
      operationId,
      tool: "send_coach_message",
      arguments: { coachId: state.coach.id, body: messageBody },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {action.type === "wellness" ? (
        <>
          <div className="rounded-2xl border border-accent/15 bg-accent/[0.055] p-3 text-xs leading-relaxed text-ink-muted">
            Leave a field blank to keep its current value unchanged. Blank values are never filled automatically.
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(wellnessValues) as WellnessKey[]).map((key) => (
              <label key={key} className="space-y-1.5 text-xs font-semibold text-ink-muted">
                <span>{wellnessLabel(key)}</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={wellnessValues[key]}
                  onChange={(event) => setWellnessValues((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={state.wellness[key] === null ? "Missing" : `Current: ${state.wellness[key]}`}
                  className="field nums"
                />
              </label>
            ))}
          </div>
        </>
      ) : null}

      {action.type === "water" ? (
        <label className="block space-y-2 text-xs font-semibold text-ink-muted">
          <span>Amount in millilitres</span>
          <div className="relative">
            <input type="number" min="50" max="5000" step="50" value={waterAmount} onChange={(event) => setWaterAmount(event.target.value)} className="field nums pr-14" aria-label="Water amount in millilitres" />
            <span className="absolute inset-y-0 right-3 flex items-center text-xs text-ink-faint">ml</span>
          </div>
          <span className="block font-normal text-ink-faint">Current total: {state.hydration.totalMl.toLocaleString("en-IN")} ml</span>
        </label>
      ) : null}

      {action.type === "training" && session ? (
        <>
          <div className="rounded-2xl bg-[#15382e] p-4 text-white">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{capitalize(session.slot)} · {session.time}</p>
            <h3 className="mt-1 text-lg font-bold">{session.title}</h3>
            <p className="mt-1 text-xs text-white/60">{session.detail}</p>
          </div>
          <label className="block space-y-1.5 text-xs font-semibold text-ink-muted">
            <span>Session result</span>
            <select value={trainingStatus} onChange={(event) => setTrainingStatus(event.target.value as typeof trainingStatus)} className="field" aria-label="Session result">
              <option value="completed">Completed</option>
              <option value="partial">Partially completed</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Sets" value={sets} onChange={setSets} min={1} max={30} />
            <NumberField label="Reps" value={reps} onChange={setReps} min={1} max={200} />
            <NumberField label="Effort /10" value={effort} onChange={setEffort} min={1} max={10} />
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">Actual sets, reps and effort are optional. Planned values are never copied silently.</p>
        </>
      ) : null}

      {action.type === "recovery" ? (
        <fieldset>
          <legend className="text-xs font-semibold text-ink-muted">Choose today&apos;s recovery activities</legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["Stretching", "Mobility", "Ice bath", "Physio"] as RecoveryModality[]).map((modality) => {
              const selected = recovery.includes(modality);
              return (
                <label key={modality} className={`flex cursor-pointer items-center gap-2 rounded-2xl border p-3 text-sm font-semibold transition ${selected ? "border-accent/30 bg-accent/10 text-accent-strong" : "border-line bg-surface-inset text-ink-muted"}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => setRecovery((current) => selected ? current.filter((item) => item !== modality) : [...current, modality])}
                    className="h-4 w-4 accent-accent"
                  />
                  {modality}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {action.type === "message" ? (
        <label className="block space-y-2 text-xs font-semibold text-ink-muted">
          <span>Message to {state.coach.name}</span>
          <textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} maxLength={500} rows={5} placeholder="Type the exact message your coach should receive…" className="field h-auto resize-none py-3" aria-label={`Message to ${state.coach.name}`} />
          <span className="block text-right font-normal text-ink-faint">{messageBody.length} / 500</span>
        </label>
      ) : null}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Saving…" : action.type === "message" ? "Send message" : "Save update"}
      </button>
      <p className="text-center text-[10px] text-ink-faint">This updates only the isolated local demo data.</p>
    </form>
  );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: string; onChange: (value: string) => void; min: number; max: number }) {
  return (
    <label className="space-y-1.5 text-xs font-semibold text-ink-muted">
      <span>{label}</span>
      <input type="number" min={min} max={max} step="1" value={value} onChange={(event) => onChange(event.target.value)} className="field nums" />
    </label>
  );
}

function DemoLoading() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-[2rem] border border-line bg-white shadow-raised">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-accent/15" />
        <p className="mt-3 text-sm font-semibold text-ink">Loading local demo data…</p>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-ink">{title}</h2>
      </div>
      <span className="shrink-0 rounded-full bg-surface-inset px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">{action}</span>
    </div>
  );
}

function MiniCard({ icon, eyebrow, title, detail, cta, onClick }: { icon: ReactNode; eyebrow: string; title: string; detail: string; cta: string; onClick: () => void }) {
  return (
    <article className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent-strong">{icon}</div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-faint">{eyebrow}</p>
      <h3 className="mt-1 text-lg font-bold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p>
      <button type="button" onClick={onClick} className="mt-4 text-sm font-bold text-accent-strong hover:underline">{cta} →</button>
    </article>
  );
}

function PlanValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-inset p-2.5"><dt className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">{label}</dt><dd className="mt-1 font-semibold text-ink">{value}</dd></div>;
}

function CoachMetric({ value, label }: { value: string; label: string }) {
  return <div className="min-w-20 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-center"><p className="nums text-lg font-bold">{value}</p><p className="text-[9px] uppercase tracking-wider text-white/45">{label}</p></div>;
}

function OutcomeStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <div className="rounded-2xl bg-surface-inset p-4"><p className="nums text-xs font-bold text-accent-strong">{number}</p><h3 className="mt-4 text-sm font-bold text-ink">{title}</h3><p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p></div>;
}

function TraceValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">{label}</dt><dd className={`mt-1 min-w-0 break-words rounded-xl bg-surface-inset p-2.5 text-xs leading-relaxed text-ink [overflow-wrap:anywhere] ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}

function ProviderRow({ name, variable, status, positive = false }: { name: string; variable: string; status: string; positive?: boolean }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-inset p-3"><div><p className="text-sm font-semibold text-ink">{name}</p><p className="mt-0.5 font-mono text-[10px] text-ink-faint">{variable}</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${positive ? "bg-ok/10 text-ok" : "bg-white text-ink-faint"}`}>{status}</span></div>;
}

function completedDailyItems(state: DemoUiState) {
  const wellnessComplete = Object.values(state.wellness).every((value) => value !== null) ? 1 : 0;
  const hydrationLogged = state.hydration.totalMl > 0 ? 1 : 0;
  const completedSessions = state.sessions.filter((session) => session.status !== "planned").length;
  const recoveryLogged = state.recovery.modalities.length > 0 ? 1 : 0;
  return Math.min(5, wellnessComplete + hydrationLogged + completedSessions + recoveryLogged);
}

function missingDemoItems(state: DemoUiState): string[] {
  const missingWellness = (["sleepQuality", "mood", "soreness", "fatigue"] as WellnessKey[])
    .filter((key) => state.wellness[key] === null)
    .map((key) => wellnessLabel(key).replace(" quality", ""));
  const sessions = state.sessions.filter((session) => session.status === "planned");
  return [
    ...missingWellness,
    ...(sessions.length ? [`${sessions.length} session${sessions.length === 1 ? "" : "s"}`] : []),
    ...(state.recovery.modalities.length ? [] : ["Recovery"]),
  ];
}

function wellnessLabel(key: WellnessKey) {
  return ({ sleepQuality: "Sleep quality", mood: "Mood", soreness: "Soreness", fatigue: "Fatigue" })[key];
}

function sessionActualDetail(session: DemoSession) {
  const actuals = [
    session.sets !== undefined && session.reps !== undefined ? `${session.sets} × ${session.reps}` : null,
    session.effortRating !== undefined ? `Effort ${session.effortRating}/10` : null,
  ].filter(Boolean);
  return actuals.length ? `Planned: ${session.detail} · Actual: ${actuals.join(" · ")}` : session.detail;
}

function joinDisplayList(values: string[]) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
