"use client";

import { forwardRef, FormEvent, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Icon } from "./ui";
import type { Role } from "../lib/roles";
import { useSpeechRecognition } from "./VoiceAssistant/useSpeechRecognition";
import { useSpeechSynthesis } from "./VoiceAssistant/useSpeechSynthesis";
import { useVoiceConversation, type VoiceConversationConfig } from "./VoiceAssistant/useVoiceConversation";

type CoachAgentContext = {
  date: string;
  athleteCount: number;
  attentionCount: number;
  presentCount: number;
  completedCount: number;
  averageReadiness: number | null;
};

type GuardianAgentContext = {
  athleteName: string;
  sleepLabel: string;
  waterLabel: string;
  attendanceLabel: string;
};

type AskAgentSheetProps = {
  role: Role;
  inputOpen: boolean;
  onCloseInput: () => void;
  onListeningChange?: (listening: boolean) => void;
  athleteConfig?: Omit<VoiceConversationConfig, "speak">;
  coachContext?: CoachAgentContext;
  guardianContext?: GuardianAgentContext;
};

export type AskAgentHandle = {
  startVoice: () => void;
};

function fallbackCoachAnswer(prompt: string, context?: CoachAgentContext): string {
  if (!context) return "I do not have the squad summary loaded yet.";
  const q = prompt.toLowerCase();
  if (q.includes("attention") || q.includes("risk") || q.includes("priority")) {
    return context.attentionCount === 0
      ? "No athletes are currently flagged for attention on this dashboard."
      : `${context.attentionCount} athlete${context.attentionCount === 1 ? "" : "s"} need attention. Use the attention strip or roster filters to open their detail sheet.`;
  }
  if (q.includes("present") || q.includes("attendance")) {
    return `${context.presentCount} of ${context.athleteCount} athlete${context.athleteCount === 1 ? "" : "s"} are marked present for ${context.date}.`;
  }
  if (q.includes("session") || q.includes("training") || q.includes("completed")) {
    return `${context.completedCount} athlete${context.completedCount === 1 ? " has" : "s have"} at least one completed session for ${context.date}.`;
  }
  if (q.includes("roster") || q.includes("athlete")) return "Use the roster search and filters to find an athlete, then open the row for readiness, RPE, notes, and profile access.";
  const readiness = context.averageReadiness === null ? "not available" : String(context.averageReadiness);
  return `Today: ${context.athleteCount} athletes, ${context.presentCount} present, ${context.completedCount} with completed sessions, ${context.attentionCount} needing attention, average readiness ${readiness}.`;
}

function fallbackGuardianAnswer(prompt: string, context?: GuardianAgentContext): string {
  if (!context) return "I do not have the athlete summary loaded yet.";
  const q = prompt.toLowerCase();
  if (q.includes("sleep")) return `${context.athleteName}'s sleep: ${context.sleepLabel}.`;
  if (q.includes("water") || q.includes("hydrat")) return `${context.athleteName}'s water intake: ${context.waterLabel}.`;
  if (q.includes("attendance") || q.includes("present")) return `${context.athleteName}'s attendance: ${context.attendanceLabel}.`;
  return `${context.athleteName}: sleep ${context.sleepLabel}, water ${context.waterLabel}, attendance ${context.attendanceLabel}.`;
}

type AskAgentLauncherProps = {
  onVoice: () => void;
  onInput: () => void;
  active?: boolean;
  busy?: boolean;
  compact?: boolean;
  /** Anchor id for the guided app tour (see lib/tour/steps.ts) — applied as data-tour on the root button. */
  tourId?: string;
};

function MiniVoiceWave() {
  return (
    <span className="flex h-4 w-4 items-center justify-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className="w-0.5 rounded-full bg-current opacity-90"
          style={{
            height: `${7 + (index % 2) * 5}px`,
            animation: `ask-agent-wave 650ms ease-in-out ${index * 90}ms infinite alternate`,
          }}
        />
      ))}
    </span>
  );
}

function useAskAgentHold({ busy, onInput, onVoice }: Pick<AskAgentLauncherProps, "busy" | "onInput" | "onVoice">) {
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef(false);
  const pointerHoldRef = useRef(false);

  function beginHold(kind: "pointer" | "hover") {
    if (busy) return;
    pointerHoldRef.current = kind === "pointer";
    longPressRef.current = false;
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    holdTimeoutRef.current = setTimeout(() => {
      longPressRef.current = true;
      onInput();
    }, 2_000);
  }

  function endHold() {
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    holdTimeoutRef.current = null;
    if (!pointerHoldRef.current) longPressRef.current = false;
  }

  function click() {
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    onVoice();
  }

  return { beginHold, endHold, click };
}

export function AskAgentButton(props: AskAgentLauncherProps) {
  const { beginHold, endHold, click } = useAskAgentHold(props);
  return (
    <button
      type="button"
      disabled={props.busy}
      data-tour={props.tourId}
      onPointerDown={() => beginHold("pointer")}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onMouseEnter={() => beginHold("hover")}
      onMouseLeave={endHold}
      onClick={click}
      onContextMenu={(event) => event.preventDefault()}
      className="btn-ghost h-9 gap-1.5 px-3 text-xs [touch-action:none]"
      aria-label="Ask agent. Tap for voice, hold for text input."
    >
      {props.active ? <MiniVoiceWave /> : <Icon.mic />}
      Ask agent
    </button>
  );
}

export function AskAgentFab(props: AskAgentLauncherProps) {
  const { beginHold, endHold, click } = useAskAgentHold(props);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center">
      <div className="flex w-full max-w-md justify-end px-4">
        <button
          type="button"
          disabled={props.busy}
          data-tour={props.tourId}
          onPointerDown={() => beginHold("pointer")}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onMouseEnter={() => beginHold("hover")}
          onMouseLeave={endHold}
          onClick={click}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Ask agent. Tap for voice, hold for text input."
          className={`pointer-events-auto flex h-14 select-none items-center gap-2 rounded-full border px-4 text-sm font-semibold shadow-hero transition [touch-action:none] disabled:opacity-45 ${
            props.active
              ? "border-accent bg-white text-accent-strong ring-4 ring-accent/20"
              : "border-accent bg-accent text-accent-ink hover:brightness-105 active:brightness-95"
          }`}
        >
          {props.active ? <MiniVoiceWave /> : <Icon.mic />}
          Ask agent
        </button>
      </div>
    </div>
  );
}

export const AskAgentSheet = forwardRef<AskAgentHandle, AskAgentSheetProps>(function AskAgentSheet({
  role,
  inputOpen,
  onCloseInput,
  onListeningChange,
  athleteConfig,
  coachContext,
  guardianContext,
}, ref) {
  const [draft, setDraft] = useState("");
  const recognition = useSpeechRecognition();
  const { speak, cancel: cancelSpeech } = useSpeechSynthesis();
  const athleteConversation = useVoiceConversation(
    athleteConfig
      ? { ...athleteConfig, speak, autoConfirmWrites: true }
      : {
      date: "",
      onNavigate: () => undefined,
      getStatusSummary: async () => "The athlete assistant is not available here.",
      refresh: async () => undefined,
      coachId: null,
      speak,
      autoConfirmWrites: true,
    }
  );

  useEffect(() => {
    onListeningChange?.(recognition.listening);
  }, [recognition.listening, onListeningChange]);

  useEffect(() => {
    if (!inputOpen) setDraft("");
  }, [inputOpen]);

  useEffect(() => {
    return () => {
      recognition.stop();
      cancelSpeech();
    };
    // Only run cleanup on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answerLocal(prompt: string) {
    const text = role === "coach" ? fallbackCoachAnswer(prompt, coachContext) : fallbackGuardianAnswer(prompt, guardianContext);
    speak(text);
  }

  async function submitPrompt(prompt: string) {
    const text = prompt.trim();
    if (!text) return;
    if (role === "athlete" && athleteConfig) {
      await athleteConversation.handleTranscript(text);
      return;
    }
    answerLocal(text);
  }

  function submitInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onCloseInput();
    void submitPrompt(text);
  }

  useImperativeHandle(ref, () => ({
    startVoice() {
      if (!recognition.supported) return;
      if (recognition.listening) {
        recognition.stop();
        return;
      }
      cancelSpeech();
      recognition.start((finalText) => {
        void submitPrompt(finalText);
      });
    },
  }));

  if (!inputOpen) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close assistant input" onClick={onCloseInput} className="absolute inset-0 cursor-default" />
      <form
        onSubmit={submitInput}
        className="absolute inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mx-auto flex w-[90vw] max-w-md items-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask agent"
          aria-label="Ask agent"
          className="h-14 min-w-0 flex-1 rounded-full border border-line bg-white px-6 text-base text-ink shadow-hero outline-none transition placeholder:text-ink-faint focus:border-accent/40 focus:ring-4 focus:ring-accent/10"
        />
        <button type="submit" disabled={!draft.trim()} className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-hero transition disabled:opacity-45" aria-label="Send command">
          <Icon.chevron />
        </button>
      </form>
    </div>
  );
});
