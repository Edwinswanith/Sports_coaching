/**
 * Adapter for turning an athlete's spoken transcript into a structured voice
 * intent. `getVoiceIntentInterpreter()` returns the real Gemini interpreter
 * when GEMINI_API_KEY is configured, otherwise a deterministic keyword-based
 * mock. To plug in a different provider, implement `VoiceIntentInterpreter`
 * and swap the resolver; nothing else in the codebase changes, since callers
 * only depend on the interface.
 *
 * IMPORTANT: this service only classifies intent and extracts structured
 * fields — it never writes to the database and never authors data-bearing
 * answers (e.g. readiness scores). The caller (the /voice/interpret route,
 * and ultimately the web client) performs the actual write via the existing
 * athlete endpoints after the user confirms, and assembles any "status"
 * answer deterministically from real fetched data.
 */

import { env } from "../config/env";

export const VOICE_INTENTS = [
  "navigate",
  "fill_wellness",
  "fill_attendance",
  "fill_training",
  "fill_rpe",
  "fill_heart_rate",
  "fill_recovery",
  "add_water",
  "add_note",
  "send_coach_message",
  "query_status",
  "unsupported",
] as const;
export type VoiceIntentName = (typeof VOICE_INTENTS)[number];

export type VoicePendingIntent = {
  intent: VoiceIntentName;
  collected: Record<string, unknown>;
  missingFields: string[];
};

export type VoiceInterpretInput = {
  transcript: string;
  today: string;
  pendingIntent?: VoicePendingIntent;
};

export type VoiceIntentResult = {
  intent: VoiceIntentName;
  fields: Record<string, unknown>;
  missingFields: string[];
  followUpQuestion?: string;
  requiresConfirmation: boolean;
  spokenResponse: string;
};

export interface VoiceIntentInterpreter {
  interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult>;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};

function parseSpokenNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().trim().replace(/-/g, " ");
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  const pointMatch = text.match(/^([a-z]+)\s+(?:point|dot)\s+([a-z]+|\d)$/);
  if (pointMatch) {
    const whole = NUMBER_WORDS[pointMatch[1]];
    const decimal = NUMBER_WORDS[pointMatch[2]] ?? Number(pointMatch[2]);
    if (whole !== undefined && Number.isFinite(decimal)) return whole + decimal / 10;
  }
  return NUMBER_WORDS[text];
}

const WRITE_INTENTS: VoiceIntentName[] = [
  "fill_wellness",
  "fill_attendance",
  "fill_training",
  "fill_rpe",
  "fill_heart_rate",
  "fill_recovery",
  "add_water",
  "add_note",
  "send_coach_message",
];

/** `requiresConfirmation` is a hardcoded app rule, not a model decision. */
function requiresConfirmationFor(intent: VoiceIntentName): boolean {
  return WRITE_INTENTS.includes(intent);
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: VOICE_INTENTS as unknown as string[] },
    fields: {
      type: "OBJECT",
      description:
        "Structured fields extracted from the transcript for the chosen intent. Only include fields " +
        "that were actually said or can be reasonably inferred — never invent values.",
      properties: {
        target: {
          type: "STRING",
          enum: ["today", "progress", "log", "coach", "messages", "water", "goals", "trends"],
          description: "navigate: which section/tab to open.",
        },
        sleepHours: { type: "NUMBER", description: "fill_wellness: hours slept, 0-14. Any daily sleep update — 'sleep', 'sleep score', 'sleep quality', or 'sleep duration' — maps here; there is no separate daily sleep-score field." },
        sleepQuality: { type: "NUMBER", description: "fill_rpe only: this session's sleep quality, spoken 1-10 scale. Never populate for fill_wellness — daily sleep updates always use sleepHours instead." },
        mood: { type: "NUMBER", description: "fill_wellness, fill_rpe: spoken 1-10 scale." },
        stress: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        soreness: { type: "NUMBER", description: "fill_wellness, fill_rpe: spoken 1-10 scale." },
        fatigue: { type: "NUMBER", description: "fill_wellness, fill_rpe: spoken 1-10 scale." },
        status: {
          type: "STRING",
          enum: ["present", "absent", "late", "excused", "rest", "planned", "in_progress", "completed", "skipped"],
          description: "fill_attendance: present/absent/late/excused/rest. fill_training: planned/in_progress/completed/skipped/rest.",
        },
        slot: { type: "STRING", enum: ["AM", "AFT", "PM"], description: "fill_training, fill_rpe: which session slot." },
        attended: { type: "BOOLEAN", description: "fill_training: whether the athlete attended/completed the session." },
        workoutType: { type: "STRING", description: "fill_training: short workout/drill label, e.g. 'Sprints'." },
        sets: { type: "NUMBER", description: "fill_training: number of sets." },
        reps: { type: "STRING", description: "fill_training: reps or distance per set, e.g. '100m'." },
        actualDurationMin: { type: "NUMBER", description: "fill_training: minutes trained, 0-600." },
        effortRating: { type: "NUMBER", description: "fill_training, fill_rpe: effort/RPE, spoken 1-10 scale." },
        notes: { type: "STRING", description: "fill_training: free-text notes, e.g. workout description or soreness callout." },
        modalities: {
          type: "ARRAY",
          items: { type: "STRING", enum: ["stretching", "ice_bath", "mobility", "physio", "hydration"] },
          description: "fill_recovery: recovery modalities completed today.",
        },
        amountMl: { type: "NUMBER", description: "add_water: amount in millilitres, 1-4000." },
        body: {
          type: "STRING",
          description: "send_coach_message: the message to send to the coach. add_note: the note text to save for the athlete's own record.",
        },
        trainingCategory: {
          type: "STRING",
          description: "fill_rpe: the training category/drill type, e.g. 'Max Speed', 'Endurance', free text.",
        },
        plannedIntensityPercent: { type: "NUMBER", description: "fill_rpe: planned intensity, 0-100 percent." },
        bodyConditionFeedback: { type: "STRING", description: "fill_rpe: free-text body condition/feedback for this session." },
        restingHeartRate: { type: "NUMBER", description: "fill_rpe: resting heart rate for this session, 20-220 bpm." },
        wakeHr: { type: "NUMBER", description: "fill_heart_rate: morning/waking resting heart rate, 25-220 bpm." },
        bedHr: { type: "NUMBER", description: "fill_heart_rate: night/bedtime resting heart rate, 25-220 bpm." },
        topic: {
          type: "STRING",
          enum: ["readiness", "hydration", "training_plan", "coach_feedback", "general"],
          description: "query_status: what the athlete is asking about.",
        },
      },
    },
    missingFields: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Field names still needed to complete this intent (empty if nothing is missing).",
    },
    followUpQuestion: {
      type: "STRING",
      description: "One short natural question to ask next if missingFields is non-empty. Omit otherwise.",
    },
    spokenResponse: {
      type: "STRING",
      description:
        "A short spoken acknowledgement. For query_status, do NOT include any numbers/scores/facts here — " +
        "the app fills those in from real data. Just confirm the topic was understood.",
    },
  },
  required: ["intent", "fields", "missingFields", "spokenResponse"],
};

const SYSTEM_PROMPT =
  "You are the natural-language understanding layer for an athlete's voice assistant in a sports " +
  "coaching app. Classify the athlete's spoken transcript into exactly one of these intents: " +
  `${VOICE_INTENTS.join(", ")}. Extract only fields that were explicitly said or unambiguously implied — ` +
  "never invent numbers or facts. Wellness/effort fields are on a spoken 1-10 scale (not the app's " +
  "internal 1-5 scale — do not convert). For fill_training, map natural workout descriptions like " +
  "'four by one hundred sprint repeats' to sets=4, reps='100m', workoutType='Sprints'. " +
  "fill_wellness is the athlete's own daily check-in (sleep, mood, stress, soreness, fatigue for the " +
  "whole day) — use it for phrases like 'log my check-in' or 'I slept 7 hours'. For update/change/set " +
  "commands, 'sleep', 'sleep score', 'sleep quality', and 'sleep duration' all mean the same thing — " +
  "sleepHours. There is no separate daily sleep-score field, so never populate sleepQuality for " +
  "fill_wellness. If the user asks to update sleep without a number, return fill_wellness with " +
  "missingFields ['sleepHours'] and ask how many hours. fill_rpe is a " +
  "per-session post-training report (slot, trainingCategory, effortRating/RPE, planned intensity, " +
  "sleepQuality, mood, soreness, fatigue, resting heart rate, body condition feedback) — use it when " +
  "the athlete describes how a specific AM/afternoon/PM session felt. fill_heart_rate is only for " +
  "'waking'/'wake up' or 'bedtime'/'before bed' resting heart rate readings (wakeHr/bedHr). add_note " +
  "is a private note to self (NOT to the coach — that is send_coach_message). For " +
  "query_status, classify the topic only — never state a readiness score, water total, or any other " +
  "number yourself, since you do not have access to real data. If a follow-up conversation turn is " +
  "provided (pendingIntent), merge newly-stated fields with the ones already collected and only ask " +
  "about fields still missing. If the transcript doesn't match any supported capability, use intent " +
  "'unsupported'.";

function buildUserPrompt(input: VoiceInterpretInput): string {
  const parts = [`Today's date: ${input.today}`];
  if (input.pendingIntent) {
    parts.push(
      `In-progress intent: ${input.pendingIntent.intent}`,
      `Already collected: ${JSON.stringify(input.pendingIntent.collected)}`,
      `Still missing: ${input.pendingIntent.missingFields.join(", ") || "(none)"}`
    );
  }
  parts.push(`Transcript: "${input.transcript}"`);
  return parts.join("\n");
}

/**
 * Real interpreter: sends the transcript (+ conversation context) to Gemini
 * and asks for a structured intent only. Throws on any failure so the caller
 * can fall back to a graceful "unsupported" response.
 */
export class GeminiVoiceIntentInterpreter implements VoiceIntentInterpreter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`gemini_http_${res.status}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("gemini_empty_response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("gemini_bad_json");
    }
    return sanitizeVoiceIntentResult(parsed, input.transcript);
  }
}

/** Trims/validates a raw model response into a safe, well-typed result. */
function sanitizeVoiceIntentResult(raw: unknown, transcript = ""): VoiceIntentResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const intent = VOICE_INTENTS.includes(r.intent as VoiceIntentName) ? (r.intent as VoiceIntentName) : "unsupported";
  const fields = r.fields && typeof r.fields === "object" ? (r.fields as Record<string, unknown>) : {};
  if (Array.isArray(fields.modalities)) {
    fields.modalities = fields.modalities.filter(
      (m): m is string => typeof m === "string" && ["stretching", "ice_bath", "mobility", "physio", "hydration"].includes(m)
    );
  }
  const missingFields = Array.isArray(r.missingFields) ? r.missingFields.filter((f): f is string => typeof f === "string") : [];
  const followUpQuestion = typeof r.followUpQuestion === "string" ? r.followUpQuestion : undefined;
  const spokenResponse = typeof r.spokenResponse === "string" ? r.spokenResponse : "Okay.";
  const lower = transcript.toLowerCase();
  // Sleep is one field — hours. Any daily sleep update, however phrased ("sleep",
  // "sleep score", "sleep quality", "sleep duration"), always resolves to sleepHours;
  // there is no separate sleep-score field to fill for fill_wellness.
  const genericSleepUpdate = intent === "fill_wellness" &&
    /\b(change|update|set|save|log|record)\b.*\bsleep\b/.test(lower);
  if (genericSleepUpdate) {
    if (typeof fields.sleepQuality === "number" && typeof fields.sleepHours !== "number") {
      fields.sleepHours = fields.sleepQuality;
    }
    delete fields.sleepQuality;
  }
  const nextMissingFields = genericSleepUpdate && typeof fields.sleepHours !== "number"
    ? Array.from(new Set([...missingFields.filter((field) => field !== "sleepQuality"), "sleepHours"]))
    : missingFields;
  return {
    intent,
    fields,
    missingFields: nextMissingFields,
    followUpQuestion: genericSleepUpdate && nextMissingFields.includes("sleepHours")
      ? "How many hours of sleep would you like to log?"
      : followUpQuestion,
    requiresConfirmation: requiresConfirmationFor(intent),
    spokenResponse,
  };
}

/**
 * Deterministic keyword-based placeholder — used for local dev without a
 * GEMINI_API_KEY and for tests, so both run with no network dependency.
 * Handles the common cases from the product spec well enough to exercise
 * the route contract; anything it can't confidently classify falls back to
 * "unsupported" rather than guessing.
 */
export class MockVoiceIntentInterpreter implements VoiceIntentInterpreter {
  async interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult> {
    const t = input.transcript.toLowerCase();

    const navTargets: Record<string, string> = {
      recovery: "log",
      today: "today",
      readiness: "today",
      progress: "progress",
      water: "water",
      hydration: "water",
      log: "log",
      training: "log",
      coach: "coach",
      feedback: "coach",
      messages: "messages",
      trends: "trends",
      goals: "goals",
    };
    if (/^(open|show|go to)\b/.test(t)) {
      for (const [keyword, target] of Object.entries(navTargets)) {
        if (t.includes(keyword)) {
          return {
            intent: "navigate",
            fields: { target },
            missingFields: [],
            requiresConfirmation: false,
            spokenResponse: `Opening ${target}.`,
          };
        }
      }
    }

    if (t.includes("how am i") || t.includes("how do i look") || t.includes("readiness")) {
      return {
        intent: "query_status",
        fields: { topic: "readiness" },
        missingFields: [],
        requiresConfirmation: false,
        spokenResponse: "Here's your status.",
      };
    }

    if (t.includes("water") || t.includes("drink") || t.includes("hydrat")) {
      const amountMatch = t.match(/(\d+)\s*ml/);
      const litreMatch = t.match(/(\d+(?:\.\d+)?)\s*l(?:itre|iter)?/);
      const amountMl = amountMatch
        ? Number(amountMatch[1])
        : litreMatch
          ? Math.round(Number(litreMatch[1]) * 1000)
          : undefined;
      if (amountMl) {
        return {
          intent: "add_water",
          fields: { amountMl },
          missingFields: [],
          requiresConfirmation: true,
          spokenResponse: `Log ${amountMl} ml of water?`,
        };
      }
      return {
        intent: "add_water",
        fields: {},
        missingFields: ["amountMl"],
        followUpQuestion: "How much water, in millilitres?",
        requiresConfirmation: true,
        spokenResponse: "How much water?",
      };
    }

    if (t.includes("coach") && (t.includes("tell") || t.includes("send") || t.includes("note") || t.includes("message"))) {
      return {
        intent: "send_coach_message",
        fields: { body: input.transcript },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: "Send this to your coach?",
      };
    }

    if (/\b(add|save|write)?\s*(?:a\s+)?note\b/.test(t) && !t.includes("coach")) {
      const body = input.transcript.replace(/^(add|save|write)?\s*(?:a\s+)?note\s*(?:that|to myself|:|-)?\s*/i, "").trim();
      return {
        intent: "add_note",
        fields: { body: body || input.transcript },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: "Save this note?",
      };
    }

    if (/\bheart\s*rate\b|\bresting\s+hr\b/.test(t) && /\bwake|waking|morning|bed|night|sleeping\b/.test(t)) {
      const m = t.match(/(\d{2,3})/);
      const bpm = m ? Number(m[1]) : undefined;
      const isWake = /\bwake|waking|morning\b/.test(t);
      const fields: Record<string, unknown> = {};
      if (bpm !== undefined) fields[isWake ? "wakeHr" : "bedHr"] = bpm;
      return {
        intent: "fill_heart_rate",
        fields,
        missingFields: bpm === undefined ? [isWake ? "wakeHr" : "bedHr"] : [],
        followUpQuestion: bpm === undefined ? "What was the reading, in beats per minute?" : undefined,
        requiresConfirmation: true,
        spokenResponse: bpm === undefined ? "What was the reading?" : `Save ${isWake ? "wake" : "bed"} heart rate ${bpm}?`,
      };
    }

    if (/\bpresent\b|\battendance\b/.test(t)) {
      const status = t.includes("late") ? "late" : t.includes("absent") ? "absent" : "present";
      return {
        intent: "fill_attendance",
        fields: { status },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: `Mark attendance as ${status}?`,
      };
    }

    if (/sleep|mood|stress|soreness|fatigue|check.?in/.test(t)) {
      const fields: Record<string, unknown> = {};
      const numberToken = "(\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\\s+(?:point|dot)\\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|\\d))";
      const numNear = (label: RegExp) => {
        const after = t.match(new RegExp(`(?:${label.source}).{0,24}?${numberToken}`));
        if (after) return parseSpokenNumber(after[1]);
        const before = t.match(new RegExp(`${numberToken}.{0,16}?(?:${label.source})`));
        return parseSpokenNumber(before?.[1]);
      };
      const sleepDuration = t.match(new RegExp(`\\b(?:change|update|set|log|record|save)?\\s*(?:my\\s+|your\\s+)?sleep(?:\\s+(?:duration|hours?|score|quality))?\\s*(?:to|as|is|=|:)?\\s*${numberToken}(?:\\s*(?:hours?|hrs?))?\\b`)) ??
        t.match(new RegExp(`${numberToken}\\s*(?:hours?|hrs?)\\b`));
      const sleepHours = parseSpokenNumber(sleepDuration?.[1]);
      // Sleep is one field — hours. "sleep", "sleep score", and "sleep quality" all
      // resolve to sleepHours; there is no separate sleep-score field to fill here.
      if (sleepHours !== undefined) fields.sleepHours = sleepHours;
      for (const [key, label] of [
        ["mood", /mood/],
        ["stress", /stress/],
        ["soreness", /soreness|sore/],
        ["fatigue", /fatigue|tired/],
      ] as const) {
        const value = numNear(label);
        if (value !== undefined) fields[key] = value;
      }
      const genericSleepUpdate = /\b(?:change|update|set|log|record|save)\b.*\bsleep\b/.test(t) && fields.sleepHours === undefined;
      return {
        intent: "fill_wellness",
        fields,
        missingFields: genericSleepUpdate ? ["sleepHours"] : [],
        followUpQuestion: genericSleepUpdate ? "How many hours of sleep would you like to log?" : undefined,
        requiresConfirmation: true,
        spokenResponse: "Save this check-in?",
      };
    }

    if (/\brpe\b|\brpm\b|\bplanned intensity\b/.test(t)) {
      const rpeMatch = t.match(/(?:rpe|rpm)[^0-9]{0,15}(\d{1,2})/);
      const slotMatch =
        /\bam\b|morning/.test(t) ? "AM" : /\baft\b|afternoon/.test(t) ? "AFT" : /\bpm\b|evening|night/.test(t) ? "PM" : undefined;
      const fields: Record<string, unknown> = {};
      if (rpeMatch) fields.effortRating = Number(rpeMatch[1]);
      if (slotMatch) fields.slot = slotMatch;
      return {
        intent: "fill_rpe",
        fields,
        missingFields: slotMatch ? [] : ["slot"],
        followUpQuestion: slotMatch ? undefined : "Which session — AM, afternoon, or PM?",
        requiresConfirmation: true,
        spokenResponse: "Save this session report?",
      };
    }

    if (/effort|sprint|session|training|workout/.test(t)) {
      return {
        intent: "fill_training",
        fields: { notes: input.transcript },
        missingFields: ["slot"],
        followUpQuestion: "Which session — AM, afternoon, or PM?",
        requiresConfirmation: true,
        spokenResponse: "Got it.",
      };
    }

    return {
      intent: "unsupported",
      fields: {},
      missingFields: [],
      requiresConfirmation: false,
      spokenResponse: "I can't do that yet.",
    };
  }
}

let interpreter: VoiceIntentInterpreter | null = null;

/**
 * Single choke point for resolving the active interpreter implementation.
 * Uses the real Gemini interpreter when GEMINI_API_KEY is configured;
 * otherwise the deterministic mock (keeps local dev and tests running with
 * no key/network).
 */
export function getVoiceIntentInterpreter(): VoiceIntentInterpreter {
  if (!interpreter) {
    interpreter = env.gemini.apiKey
      ? new GeminiVoiceIntentInterpreter(env.gemini.apiKey, env.gemini.model)
      : new MockVoiceIntentInterpreter();
  }
  return interpreter;
}

/** Test-only seam for injecting a fake interpreter. */
export function setVoiceIntentInterpreterForTests(impl: VoiceIntentInterpreter | null): void {
  interpreter = impl;
}
