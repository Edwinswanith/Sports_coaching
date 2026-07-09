"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import {
  submitWellnessAction,
  submitAttendanceAction,
  submitTrainingAction,
  submitRecoveryAction,
  addWaterAction,
  sendCoachMessageAction,
  type AttendanceStatus,
} from "../../lib/athleteActions";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../lib/sessions";

export type VoiceIntentName =
  | "navigate"
  | "fill_wellness"
  | "fill_attendance"
  | "fill_training"
  | "fill_recovery"
  | "add_water"
  | "send_coach_message"
  | "query_status"
  | "unsupported";

type InterpretResult = {
  intent: VoiceIntentName;
  fields: Record<string, unknown>;
  missingFields: string[];
  followUpQuestion?: string;
  requiresConfirmation: boolean;
  spokenResponse: string;
};

export type ConversationTurn = { role: "user" | "assistant"; text: string };
export type PendingConfirmation = { intent: VoiceIntentName; fields: Record<string, unknown>; summary: string };

export type VoiceConversationConfig = {
  date: string;
  /** Navigate to an in-page section/tab, or push to a real route (e.g. "messages"). */
  onNavigate: (target: string) => void;
  /** Deterministically assembled from already-loaded dashboard state — never LLM-authored. */
  getStatusSummary: (topic: string) => Promise<string>;
  refresh: () => Promise<void>;
  /** The athlete's single active coach, if exactly one — required for send_coach_message. */
  coachId: string | null;
  speak: (text: string) => void;
};

function isSessionSlot(v: unknown): v is SessionSlot {
  return typeof v === "string" && (SESSION_SLOTS as readonly string[]).includes(v);
}

function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === "string" && ["present", "absent", "late", "excused", "rest"].includes(v);
}

const NAV_KEYWORDS: Record<string, string> = {
  today: "today",
  readiness: "today",
  progress: "progress",
  goals: "goals",
  trends: "trends",
  water: "water",
  hydration: "water",
  log: "log",
  training: "log",
  recovery: "log",
  coach: "coach",
  feedback: "coach",
  messages: "messages",
  chat: "messages",
};

function localNavIntent(transcript: string): string | null {
  const t = transcript.toLowerCase().trim();
  if (!/^(open|show|go to)\b/.test(t)) return null;
  for (const [keyword, target] of Object.entries(NAV_KEYWORDS)) {
    if (t.includes(keyword)) return target;
  }
  return null;
}

function isAffirmative(t: string): boolean {
  return /\b(yes|yeah|yep|confirm|do it|save it|sure|correct)\b/.test(t.toLowerCase());
}
function isNegative(t: string): boolean {
  return /\b(no|nope|cancel|stop|don't|never ?mind)\b/.test(t.toLowerCase());
}

function summarize(intent: VoiceIntentName, fields: Record<string, unknown>): string {
  switch (intent) {
    case "fill_wellness":
      return `Save check-in — sleep quality ${fields.sleepQuality ?? "unset"}/10, mood ${fields.mood ?? "unset"}/10, stress ${fields.stress ?? "unset"}/10, soreness ${fields.soreness ?? "unset"}/10, fatigue ${fields.fatigue ?? "unset"}/10?`;
    case "fill_attendance":
      return `Mark today's attendance as ${fields.status}?`;
    case "fill_training": {
      const slot = isSessionSlot(fields.slot) ? SLOT_LABEL[fields.slot] : "your session";
      const bits = [fields.status ? `status ${fields.status}` : null, fields.workoutType ? `${fields.workoutType}` : null].filter(Boolean);
      return `Save ${slot}${bits.length ? ` — ${bits.join(", ")}` : ""}?`;
    }
    case "fill_recovery":
      return `Save recovery — ${(fields.modalities as string[] | undefined)?.join(", ") || "no modalities"}?`;
    case "add_water":
      return `Log ${fields.amountMl ?? "an unknown amount of"} ml of water?`;
    case "send_coach_message":
      return `Send this to your coach: "${fields.body ?? ""}"?`;
    default:
      return "Confirm this action?";
  }
}

async function performWrite(
  date: string,
  intent: VoiceIntentName,
  fields: Record<string, unknown>,
  coachId: string | null
): Promise<{ ok: boolean; message: string }> {
  switch (intent) {
    case "fill_wellness": {
      const res = await submitWellnessAction({
        date,
        sleepHours: typeof fields.sleepHours === "number" ? fields.sleepHours : undefined,
        sleepQuality: Number(fields.sleepQuality ?? 5),
        mood: Number(fields.mood ?? 5),
        stress: Number(fields.stress ?? 5),
        soreness: Number(fields.soreness ?? 5),
        fatigue: Number(fields.fatigue ?? 5),
      });
      return { ok: res.ok, message: res.ok ? "Check-in saved." : "Sorry, I couldn't save your check-in." };
    }
    case "fill_attendance": {
      if (!isAttendanceStatus(fields.status)) return { ok: false, message: "I didn't catch the attendance status." };
      const res = await submitAttendanceAction(date, fields.status);
      return { ok: res.ok, message: res.ok ? `Attendance marked ${fields.status}.` : "Sorry, I couldn't save attendance." };
    }
    case "fill_training": {
      const slot = isSessionSlot(fields.slot) ? fields.slot : "AM";
      const status = ["planned", "in_progress", "completed", "skipped", "rest"].includes(String(fields.status))
        ? (fields.status as "planned" | "in_progress" | "completed" | "skipped" | "rest")
        : undefined;
      const res = await submitTrainingAction(date, slot, {
        status,
        attended: typeof fields.attended === "boolean" ? fields.attended : status === "completed" ? true : undefined,
        workoutType: typeof fields.workoutType === "string" ? fields.workoutType : undefined,
        sets: typeof fields.sets === "number" ? fields.sets : undefined,
        reps: typeof fields.reps === "string" ? fields.reps : undefined,
        actualDurationMin: typeof fields.actualDurationMin === "number" ? fields.actualDurationMin : undefined,
        effortRating: typeof fields.effortRating === "number" ? fields.effortRating : undefined,
        notes: typeof fields.notes === "string" ? fields.notes : undefined,
      });
      return { ok: res.ok, message: res.ok ? `${SLOT_LABEL[slot]} session saved.` : "Sorry, I couldn't save that session." };
    }
    case "fill_recovery": {
      const modalities = Array.isArray(fields.modalities) ? (fields.modalities as string[]) : [];
      const res = await submitRecoveryAction(date, modalities);
      return { ok: res.ok, message: res.ok ? "Recovery saved." : "Sorry, I couldn't save recovery." };
    }
    case "add_water": {
      const amountMl = Number(fields.amountMl ?? 0);
      if (!amountMl) return { ok: false, message: "I didn't catch the amount." };
      const res = await addWaterAction(date, Math.round(amountMl));
      return { ok: res.ok, message: res.ok ? `Logged ${Math.round(amountMl)} ml of water.` : "Sorry, I couldn't log that." };
    }
    case "send_coach_message": {
      if (!coachId) return { ok: false, message: "I can't tell which coach to message — use the Messages tab instead." };
      const body = typeof fields.body === "string" ? fields.body.trim() : "";
      if (!body) return { ok: false, message: "I didn't catch a message to send." };
      const res = await sendCoachMessageAction(coachId, body);
      return { ok: res.ok, message: res.ok ? "Message sent to your coach." : "Sorry, I couldn't send that." };
    }
    default:
      return { ok: false, message: "I can't do that yet." };
  }
}

export function useVoiceConversation(config: VoiceConversationConfig) {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingIntentRef = useRef<{ intent: VoiceIntentName; collected: Record<string, unknown>; missingFields: string[] } | null>(
    null
  );

  const say = useCallback(
    (text: string) => {
      setTurns((prev) => [...prev, { role: "assistant", text }]);
      config.speak(text);
    },
    [config]
  );

  const reset = useCallback(() => {
    setTurns([]);
    setPending(null);
    pendingIntentRef.current = null;
  }, []);

  const runWrite = useCallback(
    async (intent: VoiceIntentName, fields: Record<string, unknown>) => {
      setBusy(true);
      try {
        const { ok, message } = await performWrite(config.date, intent, fields, config.coachId);
        say(message);
        if (ok) await config.refresh();
      } finally {
        setBusy(false);
        setPending(null);
        pendingIntentRef.current = null;
      }
    },
    [config, say]
  );

  const confirm = useCallback(() => {
    if (!pending) return;
    void runWrite(pending.intent, pending.fields);
  }, [pending, runWrite]);

  const cancel = useCallback(() => {
    say("Okay, cancelled.");
    setPending(null);
    pendingIntentRef.current = null;
  }, [say]);

  const handleTranscript = useCallback(
    async (rawTranscript: string) => {
      const transcript = rawTranscript.trim();
      if (!transcript) return;
      setTurns((prev) => [...prev, { role: "user", text: transcript }]);

      // A pending confirmation card is settled locally by keyword match — never
      // by another model round-trip, so it can't be talked out of by a transcript.
      if (pending) {
        if (isAffirmative(transcript)) {
          void runWrite(pending.intent, pending.fields);
          return;
        }
        if (isNegative(transcript)) {
          cancel();
          return;
        }
      }

      if (!pendingIntentRef.current) {
        const navTarget = localNavIntent(transcript);
        if (navTarget) {
          config.onNavigate(navTarget);
          say(`Opening ${navTarget}.`);
          return;
        }
      }

      setBusy(true);
      try {
        const res = await apiFetch("/api/athlete/voice/interpret", {
          method: "POST",
          body: JSON.stringify({ transcript, pendingIntent: pendingIntentRef.current ?? undefined }),
        });
        if (!res.ok) {
          say("Sorry, I couldn't reach the assistant — try again.");
          return;
        }
        const result = (await res.json()) as InterpretResult;
        const collected = { ...(pendingIntentRef.current?.collected ?? {}), ...result.fields };

        if (result.intent === "navigate") {
          const target = typeof result.fields.target === "string" ? result.fields.target : "today";
          config.onNavigate(target);
          say(result.spokenResponse || `Opening ${target}.`);
          pendingIntentRef.current = null;
          return;
        }

        if (result.intent === "query_status") {
          const topic = typeof result.fields.topic === "string" ? result.fields.topic : "general";
          say(await config.getStatusSummary(topic));
          pendingIntentRef.current = null;
          return;
        }

        if (result.intent === "unsupported") {
          say(result.spokenResponse || "I can't do that yet.");
          pendingIntentRef.current = null;
          return;
        }

        if (result.missingFields.length > 0) {
          pendingIntentRef.current = { intent: result.intent, collected, missingFields: result.missingFields };
          say(result.followUpQuestion || "Can you say that again?");
          return;
        }

        pendingIntentRef.current = null;
        if (result.requiresConfirmation) {
          const summary = summarize(result.intent, collected);
          setPending({ intent: result.intent, fields: collected, summary });
          say(summary);
        } else {
          void runWrite(result.intent, collected);
        }
      } catch {
        say("Network error — try again.");
      } finally {
        setBusy(false);
      }
    },
    [pending, config, say, runWrite, cancel]
  );

  return { turns, pending, busy, handleTranscript, confirm, cancel, reset };
}
