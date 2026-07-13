import type { WellnessKey } from "./types";

export type ReadOnlyAssistantQuestion = "daily_status" | "progress_guidance" | "coach_update";

export type ParsedWellnessAssignment = {
  field: WellnessKey | "sleepHours";
  value: number | string;
};

const WELLNESS_FIELD_PATTERN = /\b(?:sleep\s+q(?:u)?ality|sleep|mood|(?:muscle\s+)?soreness|fatigue)\b/gi;
const NUMBER_WORDS: Record<string, number> = {
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
};

export function classifyReadOnlyQuestion(message: string): ReadOnlyAssistantQuestion | null {
  const text = normalize(message);
  if (
    /did (?:my |the )?coach (?:send|sent) (?:me )?(?:any |a )?messages?/.test(text) ||
    /has (?:my |the )?coach sent (?:me )?(?:any |a )?messages?/.test(text) ||
    /(?:any|new|latest) messages? from (?:my |the )?coach/.test(text) ||
    /what did (?:my |the )?coach (?:say|send)/.test(text) ||
    /what(?:'s| is) (?:my |the )?coach(?:'s)? (?:latest )?message/.test(text) ||
    /show (?:me )?(?:my |the )?coach(?:'s)? messages?/.test(text)
  ) {
    return "coach_update";
  }

  if (
    /how (?:am i|i am) (?:doing|progressing)/.test(text) ||
    /how(?:'s| is) my progress/.test(text) ||
    /what(?:'s| is) my progress/.test(text) ||
    /am i (?:on|in) the right (?:path|track)/.test(text) ||
    /what are the things i need to improve/.test(text) ||
    /what (?:are the things )?(?:can|should|do) i (?:need to )?improve/.test(text) ||
    /what (?:can|should) i (?:do )?(?:better|improve)/.test(text) ||
    /where (?:can|should) i improve/.test(text) ||
    /how can i (?:improve|get better)/.test(text) ||
    /what should i focus on/.test(text) ||
    /give me (?:some )?(?:progress|guidance|feedback)/.test(text)
  ) {
    return "progress_guidance";
  }

  if (
    /what(?:'s| is)? (?:left|missing|remaining)/.test(text) ||
    /what have i (?:done|completed|logged)/.test(text) ||
    /how much water (?:have i|did i)/.test(text) ||
    /did i (?:log|update).*(?:wellness|check-in)/.test(text) ||
    /which (?:training|session|workout).*(?:left|pending|remaining)/.test(text) ||
    /show (?:my )?(?:daily )?status/.test(text) ||
    /how(?:'s| is) my (?:daily )?status/.test(text) ||
    /what(?:'s| is) my (?:daily )?status/.test(text) ||
    /give me (?:my |a )?status update/.test(text) ||
    /give me (?:my |an? )?(?:daily )?update/.test(text) ||
    /how am i doing today/.test(text) ||
    /how(?:'s| is) my (?:wellness|hydration|training) today/.test(text)
  ) {
    return "daily_status";
  }

  return null;
}

export function parseSingleWellnessAssignment(message: string): ParsedWellnessAssignment | null {
  const sleepHours = parseSleepHoursAssignment(message);
  if (sleepHours) return sleepHours;

  const fieldMentions = message.match(WELLNESS_FIELD_PATTERN) ?? [];
  const fields = [...new Set(fieldMentions.map(toWellnessKey).filter((value): value is WellnessKey => Boolean(value)))];
  if (fields.length !== 1) return null;

  const field = fields[0];
  const match = message.match(
    /\b(?:my\s+)?(?:muscle\s+)?(?:sleep\s+q(?:u)?ality|sleep|mood|soreness|fatigue)\b\s*(?:(?:is|was|as|to|at|=)\s*)?(.+?)\s*[.!?]*$/i,
  );
  const rawValue = match?.[1]?.trim();
  if (!rawValue) return null;

  const numericToken = rawValue.match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1];
  const parsedNumber = numericToken
    ? (NUMBER_WORDS[numericToken.toLowerCase()] ?? Number(numericToken))
    : null;

  return {
    field,
    value: parsedNumber !== null && Number.isFinite(parsedNumber) ? parsedNumber : rawValue.slice(0, 80),
  };
}

function parseSleepHoursAssignment(message: string): ParsedWellnessAssignment | null {
  const text = normalize(message);
  const mentionsSleepDuration =
    /\b(?:sleep|screen)\s+(?:quantity|duration|hours?|hrs?)\b/.test(text) ||
    /\b(?:sleep|screen)\b.*\b(?:quantity|duration|hours?|hrs?)\b/.test(text) ||
    /\b(?:hours?|hrs?)\b.*\b(?:sleep|screen)\b/.test(text);
  if (!mentionsSleepDuration) return null;

  const token = text.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours?|hrs?|h)\b/)?.[1] ??
    text.match(/\b(?:up\s+to|to|at|is|was|as)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/)?.[1];
  if (!token) return null;
  const value = NUMBER_WORDS[token] ?? Number(token);
  return { field: "sleepHours", value };
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[?.!]+$/g, "").replace(/\s+/g, " ");
}

function toWellnessKey(value: string): WellnessKey | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("sleep")) return "sleepQuality";
  if (normalized.includes("mood")) return "mood";
  if (normalized.includes("soreness")) return "soreness";
  if (normalized.includes("fatigue")) return "fatigue";
  return null;
}
