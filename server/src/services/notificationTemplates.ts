/**
 * Pure copy builders — one per sweep/event-driven notification type introduced
 * for push. No DB reads here; callers already queried whatever context they
 * need. `message`/`announcement` deliberately keep their existing inline copy
 * in services/messaging.ts / routes/coach.ts (not duplicated here) so the
 * in-app row and the push payload can never drift apart for those two.
 *
 * `link` is a best-effort default — callers that need an athlete-scoped path
 * (readiness_risk_flag, injury_alert) override it with the concrete path once
 * they know the athleteId.
 */
export type TemplateResult = { title: string; body: string; link: string | null };
type ReminderSlot = "AM" | "AFT" | "PM";

function slotLabel(slot: ReminderSlot): string {
  return slot === "AFT" ? "Afternoon" : slot;
}

export function buildDailyCheckinReminder(): TemplateResult {
  return {
    title: "Check-in reminder",
    body: "Don't forget today's check-in — how are you feeling?",
    link: "/athlete/dashboard",
  };
}

export function buildTrainingSessionReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `Log your ${label} session`,
    body: `Mark your ${label} session completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildRpeMonitoringReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `${label} RPE reminder`,
    body: `Log your ${label} RPE so your coach can see today's load.`,
    link: "/athlete/dashboard",
  };
}

export function buildMissedActivityReminder(input: { count: number }): TemplateResult {
  const sessionLabel = input.count === 1 ? "session" : "sessions";
  return {
    title: "Finish yesterday's activity log",
    body: `You still have ${input.count} planned ${sessionLabel} to mark completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildReadinessRiskFlag(input: {
  athleteName: string;
  riskReasons: string[];
}): TemplateResult {
  return {
    title: `${input.athleteName}'s readiness flagged`,
    body: input.riskReasons.length
      ? input.riskReasons.join("; ")
      : "Check their latest RPE entry.",
    link: null,
  };
}

export function buildInjuryAlert(input: {
  athleteName: string;
  bodyPart: string;
  severity: string;
  restriction?: string | null;
}): TemplateResult {
  const label =
    input.severity === "severe"
      ? "Severe injury"
      : input.severity === "moderate"
        ? "Injury"
        : "Minor injury";
  return {
    title: `${label} logged: ${input.athleteName}`,
    body: `${input.bodyPart}${input.restriction ? ` — ${input.restriction}` : ""}`,
    link: null,
  };
}

export function buildNoteNeedsReply(input: {
  athleteName: string;
  hours: number;
}): TemplateResult {
  return {
    title: "A note is waiting for a reply",
    body: `${input.athleteName} left a note ${input.hours}h ago — take a look.`,
    link: null,
  };
}

export function buildAthleteWeeklySummary(input: {
  checkins: number;
  sessions: number;
  readinessAvg: number | null;
}): TemplateResult {
  const avg = input.readinessAvg == null ? "n/a" : `${input.readinessAvg}%`;
  return {
    title: "Your week in review",
    body: `Your week: ${input.checkins}/7 check-ins, ${input.sessions} sessions, readiness avg ${avg}.`,
    link: "/athlete/dashboard",
  };
}

export function buildCoachSquadDigest(input: {
  presentCount: number;
  totalSlots: number;
  flaggedCount: number;
}): TemplateResult {
  return {
    title: "Your squad this week",
    body: `${input.presentCount}/${input.totalSlots} attendance, ${input.flaggedCount} readiness flags.`,
    link: "/coach/dashboard",
  };
}

export function buildStreakMilestone(input: {
  goalTitle: string;
  badgeLabel: string;
  streakCount: number;
}): TemplateResult {
  return {
    title: `${input.badgeLabel} unlocked`,
    body: `${input.streakCount}-day ${input.goalTitle.toLowerCase()} — keep it going.`,
    link: "/athlete/achievements",
  };
}

export function buildCoachFeedback(input: { coachName: string; preview: string }): TemplateResult {
  return {
    title: `Feedback from ${input.coachName}`,
    body: input.preview,
    link: "/athlete/dashboard",
  };
}
