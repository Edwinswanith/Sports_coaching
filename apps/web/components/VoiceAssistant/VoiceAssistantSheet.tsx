"use client";

import { useEffect, useRef } from "react";
import { BottomSheet } from "../BottomSheet";
import { Icon } from "../ui";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useSpeechSynthesis } from "./useSpeechSynthesis";
import { useVoiceConversation, type VoiceConversationConfig } from "./useVoiceConversation";

export function VoiceAssistantSheet({
  open,
  onClose,
  config,
}: {
  open: boolean;
  onClose: () => void;
  config: Omit<VoiceConversationConfig, "speak">;
}) {
  const { speak, cancel: cancelSpeech } = useSpeechSynthesis();
  const conversation = useVoiceConversation({ ...config, speak });
  const recognition = useSpeechRecognition();
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      recognition.stop();
      cancelSpeech();
      conversation.reset();
    }
    // Only react to the sheet opening/closing, not to hook identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation.turns, conversation.pending]);

  if (!recognition.supported) return null;

  function toggleMic() {
    if (recognition.listening) {
      recognition.stop();
      return;
    }
    cancelSpeech();
    recognition.start((finalText) => {
      void conversation.handleTranscript(finalText);
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={<p className="font-display text-base font-semibold text-ink">Voice assistant</p>}
    >
      <div className="flex flex-col gap-4">
        <div ref={logRef} className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface-inset p-3">
          {conversation.turns.length === 0 ? (
            <p className="text-xs text-ink-faint">
              Tap the mic and try: &ldquo;Open recovery&rdquo;, &ldquo;Sleep quality is 8&rdquo;, or &ldquo;How am I today?&rdquo;
            </p>
          ) : (
            conversation.turns.map((turn, i) => (
              <div key={i} className={`text-sm ${turn.role === "user" ? "text-ink" : "text-accent-strong"}`}>
                <span className="font-semibold">{turn.role === "user" ? "You: " : "Assistant: "}</span>
                {turn.text}
              </div>
            ))
          )}
          {recognition.listening && recognition.interimTranscript ? (
            <p className="text-sm italic text-ink-muted">{recognition.interimTranscript}…</p>
          ) : null}
        </div>

        {conversation.pending ? (
          <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
            <p className="text-sm font-semibold text-ink">{conversation.pending.summary}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => conversation.confirm()} disabled={conversation.busy} className="btn-primary h-10 flex-1">
                Confirm
              </button>
              <button onClick={() => conversation.cancel()} disabled={conversation.busy} className="btn-secondary h-10 flex-1">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <button
          onClick={toggleMic}
          disabled={conversation.busy}
          aria-pressed={recognition.listening}
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border transition ${
            recognition.listening
              ? "border-accent bg-accent text-accent-ink animate-pulse"
              : "border-line bg-surface-inset text-ink-muted hover:text-ink"
          }`}
        >
          <span className="scale-150">
            <Icon.mic />
          </span>
        </button>
        <p className="text-center text-[11px] text-ink-faint">
          {conversation.busy ? "Thinking…" : recognition.listening ? "Listening — tap to stop" : "Tap to speak"}
        </p>
      </div>
    </BottomSheet>
  );
}
