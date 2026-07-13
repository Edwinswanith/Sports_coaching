import "server-only";

import path from "node:path";
import dotenv from "dotenv";
import { classifyReadOnlyQuestion, parseSingleWellnessAssignment } from "./assistantRules";
import type { AssistantDebug, DemoState } from "./types";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const ASSISTANT_CANDIDATE_TOOLS = [
  "get_daily_status",
  "get_progress_guidance",
  "get_coach_update",
  "add_water",
  "record_wellness",
  "update_training_session",
  "record_recovery",
  "send_coach_message",
  "unsupported",
] as const;

export type AssistantCandidateTool = (typeof ASSISTANT_CANDIDATE_TOOLS)[number];
export type AssistantCandidate = { tool: AssistantCandidateTool; arguments: Record<string, unknown> };
export type AssistantInterpretation = { candidates: AssistantCandidate[]; debug: AssistantDebug };

export class AssistantInterpreterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AssistantInterpreterError";
  }
}

const FUNCTION_DECLARATIONS = [
  {
    name: "get_daily_status",
    description: "Use for questions about what remains today, hydration total, wellness completion, or incomplete training.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_progress_guidance",
    description: "Use for questions about progress, being on track, what to improve, priorities, feedback, or what to focus on.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_coach_update",
    description: "Use for read-only questions about whether the assigned coach sent a message, what the coach said, or the latest coach message.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "add_water",
    description: "Propose adding a stated amount of water. Omit amountMl if the athlete did not state an amount. Convert litres to millilitres.",
    parameters: {
      type: "OBJECT",
      properties: { amountMl: { type: "NUMBER", description: "Explicitly stated water amount normalized to millilitres." } },
    },
  },
  {
    name: "record_wellness",
    description: "Propose explicitly stated wellness values only. Never add a value the athlete did not say.",
    parameters: {
      type: "OBJECT",
      properties: {
        sleepQuality: { type: "NUMBER", description: "Sleep quality on the athlete-facing 1 to 10 scale." },
        mood: { type: "NUMBER", description: "Mood on the athlete-facing 1 to 10 scale." },
        soreness: { type: "NUMBER", description: "Soreness on the athlete-facing 1 to 10 scale." },
        fatigue: { type: "NUMBER", description: "Fatigue on the athlete-facing 1 to 10 scale." },
      },
    },
  },
  {
    name: "update_training_session",
    description: "Propose an athlete-reported outcome for one existing session. Never assume a slot or actual values.",
    parameters: {
      type: "OBJECT",
      properties: {
        sessionReference: { type: "STRING", description: "Words the athlete used to identify the session, such as morning, evening, conditioning, or strength." },
        status: { type: "STRING", enum: ["completed", "partial", "skipped"] },
        sets: { type: "NUMBER", description: "Actual sets, only if explicitly stated." },
        reps: { type: "NUMBER", description: "Actual repetitions, only if explicitly stated." },
        effort: { type: "NUMBER", description: "Session effort on a 1 to 10 scale, only if explicitly stated." },
      },
    },
  },
  {
    name: "record_recovery",
    description: "Propose explicitly stated recovery activities only.",
    parameters: {
      type: "OBJECT",
      properties: {
        modalities: {
          type: "ARRAY",
          items: { type: "STRING", enum: ["Stretching", "Mobility", "Ice bath", "Physio"] },
        },
      },
    },
  },
  {
    name: "send_coach_message",
    description: "Propose sending one exact message to the assigned coach. Return only the intended message body, without 'tell my coach'.",
    parameters: { type: "OBJECT", properties: { body: { type: "STRING" } } },
  },
  {
    name: "unsupported",
    description: "Use when the request is unrelated, unsafe, or outside the available athlete reporting tools.",
    parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } } },
  },
] as const;

const SYSTEM_INSTRUCTION = `You are the language-understanding layer for a constrained athlete reporting assistant.
You may only propose the declared functions. You never execute them.
Extract only values the athlete explicitly stated. Never manufacture neutral or midpoint wellness values.
Never invent athlete IDs, session IDs, coach IDs, dates, or permissions.
If a session is not identified, omit sessionReference so deterministic code can resolve or ask.
If an amount or value is missing, omit it. Do not guess.
For compound requests, return every relevant function call so the application can ask the athlete to handle one action at a time.
For coach messages, preserve the athlete's intended message, but remove wrapper language such as "tell my coach that".
Use get_daily_status for factual questions about today's status. Use get_progress_guidance for progress, feedback, priorities, improvement, or focus questions. Use get_coach_update for read-only questions about messages received from the coach. Use unsupported for unrelated requests.`;

export async function interpretAssistantMessage(message: string, state: DemoState): Promise<AssistantInterpretation> {
  const startedAt = Date.now();
  const readOnlyQuestion = classifyReadOnlyQuestion(message);
  if (readOnlyQuestion) {
    const tool = readOnlyQuestion === "progress_guidance"
      ? "get_progress_guidance"
      : readOnlyQuestion === "coach_update"
        ? "get_coach_update"
        : "get_daily_status";
    return {
      candidates: [{ tool, arguments: {} }],
      debug: { provider: "deterministic", latencyMs: Date.now() - startedAt, candidateTools: [tool] },
    };
  }

  const genericWellnessMatch = message.match(
    /\bwellness\s+(?:score\s+)?(?:is|was|=)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  );
  if (genericWellnessMatch) {
    return {
      candidates: [{ tool: "record_wellness", arguments: { wellnessScore: parseOneToTen(genericWellnessMatch[1]) } }],
      debug: { provider: "deterministic", latencyMs: Date.now() - startedAt, candidateTools: ["record_wellness"] },
    };
  }

  const wellnessAssignment = parseSingleWellnessAssignment(message);
  if (wellnessAssignment) {
    const argumentsForCandidate = typeof wellnessAssignment.value === "number"
      ? { [wellnessAssignment.field]: wellnessAssignment.value }
      : { wellnessField: wellnessAssignment.field, wellnessValue: wellnessAssignment.value };
    return {
      candidates: [{ tool: "record_wellness", arguments: argumentsForCandidate }],
      debug: { provider: "deterministic", latencyMs: Date.now() - startedAt, candidateTools: ["record_wellness"] },
    };
  }

  const explicitCoachMessage = parseExplicitCoachMessage(message);
  if (explicitCoachMessage) {
    return {
      candidates: [{ tool: "send_coach_message", arguments: { body: explicitCoachMessage } }],
      debug: { provider: "deterministic", latencyMs: Date.now() - startedAt, candidateTools: ["send_coach_message"] },
    };
  }

  const compoundTools = detectCompoundWriteTools(message);
  if (compoundTools.length > 1) {
    return {
      candidates: compoundTools.map((tool) => ({ tool, arguments: {} })),
      debug: { provider: "deterministic", latencyMs: Date.now() - startedAt, candidateTools: compoundTools },
    };
  }

  const apiKey = process.env.GOOGLE_API_KEY ?? "";
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  if (!apiKey) throw new AssistantInterpreterError("gemini_not_configured", "Gemini is not configured for this local demo.");

  const context = {
    localDate: state.athlete.dateKey,
    timezone: state.athlete.timezone,
    sessions: state.sessions.map(({ slot, title, status }) => ({ slot, title, status })),
    assignedCoach: state.coach.name,
  };
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `Athlete context: ${JSON.stringify(context)}\nAthlete message: ${JSON.stringify(message)}` }],
      },
    ],
    tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } },
    generationConfig: { temperature: 0 },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new AssistantInterpreterError("gemini_request_failed", `Gemini could not interpret this request (${response.status}).`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name?: string; args?: unknown } }> } }>;
  };
  const calls = (json.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.functionCall)
    .filter((call): call is { name: string; args?: unknown } => Boolean(call?.name));

  const candidates = calls.map(sanitizeFunctionCall);
  if (!candidates.length) {
    throw new AssistantInterpreterError("gemini_empty_function_call", "Gemini did not return a supported athlete action.");
  }

  return {
    candidates,
    debug: {
      provider: "gemini",
      model,
      latencyMs: Date.now() - startedAt,
      candidateTools: candidates.map((candidate) => candidate.tool),
    },
  };
}

function sanitizeFunctionCall(call: { name: string; args?: unknown }): AssistantCandidate {
  const tool = ASSISTANT_CANDIDATE_TOOLS.includes(call.name as AssistantCandidateTool)
    ? (call.name as AssistantCandidateTool)
    : "unsupported";
  const args = call.args && typeof call.args === "object" && !Array.isArray(call.args)
    ? (call.args as Record<string, unknown>)
    : {};
  return { tool, arguments: args };
}

function detectCompoundWriteTools(message: string): AssistantCandidateTool[] {
  const text = message.trim().toLowerCase();
  if (/^(tell|message|send)\b/.test(text)) return [];

  const tools: AssistantCandidateTool[] = [];
  if (/\b(water|drink|drank|hydration|litre|liter|\d+\s*ml)\b/.test(text)) tools.push("add_water");
  if (/\b(sleep|mood|soreness|fatigue|wellness|check-in)\b/.test(text)) tools.push("record_wellness");
  if (/\b(training|workout|session|strength|conditioning|sets?|reps?)\b/.test(text)) tools.push("update_training_session");
  if (/\b(stretching|mobility|ice bath|physio|recovery)\b/.test(text)) tools.push("record_recovery");
  if (/\b(tell|message|send)\b.*\bcoach\b|\bcoach\b.*\b(tell|message|send)\b/.test(text)) tools.push("send_coach_message");
  return [...new Set(tools)];
}

function parseExplicitCoachMessage(message: string): string | null {
  const trimmed = message.trim();
  const patterns = [
    /^(?:tell|message|send)(?:\s+(?:a\s+message\s+)?to)?\s+my\s+coach(?:\s+that)?\s+(.+)$/i,
    /^(?:tell|message|send)(?:\s+(?:a\s+message\s+)?to)?\s+coach\s+\S+(?:\s+that)?\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const body = trimmed.match(pattern)?.[1]?.trim();
    if (body) return body;
  }
  return null;
}

function parseOneToTen(value: string) {
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return numeric;
  return ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 })[
    value.toLowerCase() as "one"
  ];
}
