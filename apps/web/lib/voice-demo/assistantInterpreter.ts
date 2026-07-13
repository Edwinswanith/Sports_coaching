import "server-only";

import path from "node:path";
import dotenv from "dotenv";
import { classifyReadOnlyQuestion, parseSingleWellnessAssignment } from "./assistantRules";
import { getActiveDemoDay, type AssistantConversationContext, type AssistantDebug, type DemoState } from "./types";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const ASSISTANT_CANDIDATE_TOOLS = [
  "get_daily_status",
  "get_progress_summary",
  "compare_periods",
  "find_best_day",
  "get_day_details",
  "get_coach_update",
  "get_coach_workout_plan",
  "explain_exercise_prescription",
  "evaluate_intensity_question",
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
  functionDeclaration("get_daily_status", "Questions about today's reporting status, hydration, wellness, or pending training", {}),
  functionDeclaration("get_progress_summary", "Progress, improvement priorities, trends, or being on track", {
    rangeDays: { type: "NUMBER", description: "7, 14, or 30 when explicitly stated" },
  }),
  functionDeclaration("compare_periods", "Compare the first two weeks with the last two weeks", {}),
  functionDeclaration("find_best_day", "Find a best day for a specific metric, or ask which metric if none was stated", {
    metric: { type: "STRING", enum: ["readiness", "trainingCompletion", "sprint30m", "sprint100m", "verticalJump", "farmersWalk40m"] },
  }),
  functionDeclaration("get_day_details", "Explain or retrieve evidence for one recorded date", {
    dateKey: { type: "STRING", description: "ISO date only when explicitly stated or supplied by conversation context" },
  }),
  functionDeclaration("get_coach_update", "Read messages received from the assigned coach", {}),
  functionDeclaration("get_coach_workout_plan", "Read Coach Priya's published workout for a date", {
    dateKey: { type: "STRING", description: "ISO plan date when known" },
  }),
  functionDeclaration("explain_exercise_prescription", "Explain sets, reps, distance, load, RPE, or rest for an exercise in the published plan", {
    exerciseReference: { type: "STRING" },
    planId: { type: "STRING", description: "Only use a plan ID supplied in application context" },
  }),
  functionDeclaration("evaluate_intensity_question", "Questions about increasing intensity or which workouts to continue; provide evidence without prescribing", {
    mode: { type: "STRING", enum: ["increase", "continue"] },
  }),
  functionDeclaration("add_water", "Propose adding an explicitly stated water amount, normalized to millilitres", {
    amountMl: { type: "NUMBER" },
  }),
  functionDeclaration("record_wellness", "Propose explicitly stated wellness values only", {
    sleepQuality: { type: "NUMBER" }, mood: { type: "NUMBER" }, soreness: { type: "NUMBER" }, fatigue: { type: "NUMBER" },
  }),
  functionDeclaration("update_training_session", "Propose an outcome for one existing session; never assume actual values", {
    sessionReference: { type: "STRING" },
    status: { type: "STRING", enum: ["completed", "partial", "skipped"] },
    sets: { type: "NUMBER" }, reps: { type: "NUMBER" }, effort: { type: "NUMBER" }, actualDurationMinutes: { type: "NUMBER" },
  }),
  functionDeclaration("record_recovery", "Propose explicitly stated recovery activities", {
    modalities: { type: "ARRAY", items: { type: "STRING", enum: ["Stretching", "Mobility", "Ice bath", "Physio"] } },
  }),
  functionDeclaration("send_coach_message", "Propose one exact message to Coach Priya", { body: { type: "STRING" } }),
  functionDeclaration("unsupported", "Requests outside the available reporting, analytics, and coach-plan tools", {
    reason: { type: "STRING" },
  }),
] as const;

const SYSTEM_INSTRUCTION = `You are the language-understanding layer for a constrained athlete assistant.
You may only propose declared functions and never execute them. The application calculates every numeric fact.
Extract only values explicitly stated by the athlete. Never invent wellness values, dates, IDs, exercise loads, permissions, or results.
Coach Priya alone prescribes training intensity and volume. For questions about increasing intensity or continuing workouts, select evaluate_intensity_question; never prescribe a change.
For compound write requests, return each write function so the application can ask the athlete to handle one at a time.
For read-only questions return one best matching function. Use unsupported only when nothing applies.`;

export async function interpretAssistantMessage(
  message: string,
  state: DemoState,
  conversationContext: AssistantConversationContext = {},
): Promise<AssistantInterpretation> {
  const startedAt = Date.now();
  const deterministic = deterministicInterpretation(message, conversationContext);
  if (deterministic) return withDebug(deterministic, startedAt, message, conversationContext);

  const compoundTools = detectCompoundWriteTools(message);
  if (compoundTools.length > 1) {
    return withDebug(compoundTools.map((tool) => ({ tool, arguments: {} })), startedAt, message, conversationContext);
  }

  const apiKey = process.env.GOOGLE_API_KEY ?? "";
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  if (!apiKey) throw new AssistantInterpreterError("gemini_not_configured", "Gemini is not configured for this local demo.");
  const today = getActiveDemoDay(state);
  const applicationContext = {
    localDate: state.athlete.dateKey,
    timezone: state.athlete.timezone,
    todaySessions: today.sessions.map(({ slot, title, status }) => ({ slot, title, status })),
    assignedCoach: state.coach.name,
    availableHistory: { start: state.days[0].dateKey, end: state.days.at(-1)?.dateKey },
    validatedConversationContext: conversationContext,
  };
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: `Application context: ${JSON.stringify(applicationContext)}\nAthlete message: ${JSON.stringify(message)}` }] }],
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
  if (!response.ok) throw new AssistantInterpreterError("gemini_request_failed", `Gemini could not interpret this request (${response.status}).`);
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name?: string; args?: unknown } }> } }>;
  };
  const candidates = (json.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.functionCall)
    .filter((call): call is { name: string; args?: unknown } => Boolean(call?.name))
    .map(sanitizeFunctionCall);
  if (!candidates.length) throw new AssistantInterpreterError("gemini_empty_function_call", "Gemini did not return a supported athlete action.");
  return {
    candidates,
    debug: {
      provider: "gemini",
      model,
      latencyMs: Date.now() - startedAt,
      candidateTools: candidates.map((candidate) => candidate.tool),
      normalizedQuery: normalize(message),
      context: conversationContext,
    },
  };
}

function deterministicInterpretation(message: string, context: AssistantConversationContext): AssistantCandidate[] | null {
  const text = normalize(message);
  if (/^(why|why was that|why is that)$/.test(text) && context.dateKey) {
    return [{ tool: "get_day_details", arguments: { dateKey: context.dateKey } }];
  }
  if (/^(?:and |what about )?(?:the )?(sled|slide)(?: push)?$/.test(text)) {
    return [{ tool: "explain_exercise_prescription", arguments: { exerciseReference: "sled push", ...(context.planId ? { planId: context.planId } : {}) } }];
  }
  if (/compare my first two weeks (?:with|to|and) my last two weeks/.test(text)) return [{ tool: "compare_periods", arguments: {} }];
  if (/which day (?:did i perform|was my performance) best/.test(text) || /what was my best day/.test(text)) {
    return [{ tool: "find_best_day", arguments: {} }];
  }
  if (/best readiness/.test(text)) return [{ tool: "find_best_day", arguments: { metric: "readiness" } }];
  if (/best 30\s*m/.test(text)) return [{ tool: "find_best_day", arguments: { metric: "sprint30m" } }];
  if (/best 100\s*m/.test(text)) return [{ tool: "find_best_day", arguments: { metric: "sprint100m" } }];
  if (/best (?:vertical )?jump/.test(text)) return [{ tool: "find_best_day", arguments: { metric: "verticalJump" } }];
  if (/best farmer/.test(text)) return [{ tool: "find_best_day", arguments: { metric: "farmersWalk40m" } }];
  if (/should i (?:increase|raise|add).*(?:intensity|load|weight)|(?:increase|raise).*(?:intensity|load|weight)/.test(text)) {
    return [{ tool: "evaluate_intensity_question", arguments: { mode: "increase" } }];
  }
  if (/which workouts? should i continue|what workouts? should i continue/.test(text)) {
    return [{ tool: "evaluate_intensity_question", arguments: { mode: "continue" } }];
  }
  if (/what (?:has|did) coach priya plan(?:ned)? for monday|what(?:'s| is) (?:my )?(?:monday )?(?:coach )?workout plan/.test(text)) {
    return [{ tool: "get_coach_workout_plan", arguments: { dateKey: "2026-07-13" } }];
  }
  const exercise = exerciseReference(text);
  if (exercise && /(?:how many|how much|what intensity|what load|what rpe|what rest|should i do|plan)/.test(text)) {
    return [{ tool: "explain_exercise_prescription", arguments: { exerciseReference: exercise, ...(context.planId ? { planId: context.planId } : {}) } }];
  }
  const explicitDate = parseDateReference(text);
  if (explicitDate && /(?:what happened|how did i do|show|data|details|perform)/.test(text)) {
    return [{ tool: "get_day_details", arguments: { dateKey: explicitDate } }];
  }
  if (/how did i progress (?:this|over the) month|monthly progress|progress (?:this|over the) month/.test(text)) {
    return [{ tool: "get_progress_summary", arguments: { rangeDays: 30 } }];
  }
  if (/^(?:i\s+)?(?:completed|finished)\s+(?:my\s+)?(?:training|workout|session)$/.test(text)) {
    return [{ tool: "update_training_session", arguments: { status: "completed" } }];
  }
  if (/last 7 days|this week|past week/.test(text) && /progress|doing|improve/.test(text)) {
    return [{ tool: "get_progress_summary", arguments: { rangeDays: 7 } }];
  }
  if (/last 14 days|two weeks|past fortnight/.test(text) && /progress|doing|improve/.test(text)) {
    return [{ tool: "get_progress_summary", arguments: { rangeDays: 14 } }];
  }

  const readOnly = classifyReadOnlyQuestion(message);
  if (readOnly === "daily_status") return [{ tool: "get_daily_status", arguments: {} }];
  if (readOnly === "progress_guidance") return [{ tool: "get_progress_summary", arguments: { rangeDays: 30 } }];
  if (readOnly === "coach_update") return [{ tool: "get_coach_update", arguments: {} }];

  const genericWellnessMatch = message.match(/\bwellness\s+(?:score\s+)?(?:is|was|=)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (genericWellnessMatch) return [{ tool: "record_wellness", arguments: { wellnessScore: parseOneToTen(genericWellnessMatch[1]) } }];
  const wellnessAssignment = parseSingleWellnessAssignment(message);
  if (wellnessAssignment) {
    return [{
      tool: "record_wellness",
      arguments: typeof wellnessAssignment.value === "number"
        ? { [wellnessAssignment.field]: wellnessAssignment.value }
        : { wellnessField: wellnessAssignment.field, wellnessValue: wellnessAssignment.value },
    }];
  }
  const coachMessage = parseExplicitCoachMessage(message);
  if (coachMessage) return [{ tool: "send_coach_message", arguments: { body: coachMessage } }];
  return null;
}

function functionDeclaration(name: string, description: string, properties: Record<string, unknown>) {
  return { name, description, parameters: { type: "OBJECT", properties } };
}

function withDebug(candidates: AssistantCandidate[], startedAt: number, message: string, context: AssistantConversationContext): AssistantInterpretation {
  return {
    candidates,
    debug: {
      provider: "deterministic",
      latencyMs: Date.now() - startedAt,
      candidateTools: candidates.map((candidate) => candidate.tool),
      normalizedQuery: normalize(message),
      context,
    },
  };
}

function sanitizeFunctionCall(call: { name: string; args?: unknown }): AssistantCandidate {
  const tool = ASSISTANT_CANDIDATE_TOOLS.includes(call.name as AssistantCandidateTool)
    ? (call.name as AssistantCandidateTool)
    : "unsupported";
  const args = call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args as Record<string, unknown> : {};
  return { tool, arguments: args };
}

function detectCompoundWriteTools(message: string): AssistantCandidateTool[] {
  const text = normalize(message);
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
  const patterns = [
    /^(?:tell|message|send)(?:\s+(?:a\s+message\s+)?to)?\s+my\s+coach(?:\s+that)?\s+(.+)$/i,
    /^(?:tell|message|send)(?:\s+(?:a\s+message\s+)?to)?\s+coach\s+\S+(?:\s+that)?\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const body = message.trim().match(pattern)?.[1]?.trim();
    if (body) return body;
  }
  return null;
}

function exerciseReference(text: string): string | null {
  if (/farmer/.test(text)) return "farmer's walk";
  if (/tire\s*flip/.test(text)) return "tire flip";
  if (/sled|slide/.test(text)) return "sled push";
  return null;
}

function parseDateReference(text: string): string | null {
  const iso = text.match(/\b(2026-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(june|july)\b/);
  if (!named) return null;
  const month = named[2] === "june" ? "06" : "07";
  return `2026-${month}-${named[1].padStart(2, "0")}`;
}

function parseOneToTen(value: string) {
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return numeric;
  return ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 })[
    value.toLowerCase() as "one"
  ];
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[?.!]+$/g, "").replace(/\s+/g, " ");
}
