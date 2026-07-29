import { notificationPreview } from "./notificationCopy";

/**
 * Pure copy builders - one per sweep/event-driven notification type introduced
 * for push. No DB reads here; callers already queried whatever context they
 * need. `message`/`announcement` deliberately keep their existing inline copy
 * in services/messaging.ts / routes/coach.ts (not duplicated here) so the
 * in-app row and the push payload can never drift apart for those two.
 *
 * `link` is a best-effort default - callers that need an athlete-scoped path
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
    title: "Daily check-in reminder",
    body: "Please complete today's check-in so your coach can review your readiness.",
    link: "/athlete/dashboard",
  };
}

export function buildTrainingSessionReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `${label} session reminder`,
    body: `Please mark your ${label} session as completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildRpeMonitoringReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `${label} RPE reminder`,
    body: `Please log your ${label} RPE so your coach can review today's load.`,
    link: "/athlete/dashboard",
  };
}

export function buildMissedActivityReminder(input: { count: number }): TemplateResult {
  const sessionLabel = input.count === 1 ? "session" : "sessions";
  return {
    title: "Activity log reminder",
    body: `You still have ${input.count} planned ${sessionLabel} from yesterday to mark as completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildReadinessRiskFlag(input: {
  athleteName: string;
  riskReasons: string[];
}): TemplateResult {
  return {
    title: `Readiness alert for ${input.athleteName}`,
    body: input.riskReasons.length
      ? notificationPreview(input.riskReasons.join("; "))
      : "Please review their latest RPE entry.",
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
    title: `${label} alert for ${input.athleteName}`,
    body: notificationPreview(`${input.bodyPart}${input.restriction ? ` - ${input.restriction}` : ""}`),
    link: null,
  };
}

export function buildNoteNeedsReply(input: {
  athleteName: string;
  hours: number;
}): TemplateResult {
  return {
    title: "Athlete note needs a reply",
    body: `${input.athleteName} left a note ${input.hours}h ago. Please review and respond.`,
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
    title: "Weekly summary ready",
    body: `This week: ${input.checkins}/7 check-ins, ${input.sessions} sessions, readiness average ${avg}.`,
    link: "/athlete/dashboard",
  };
}

export function buildCoachSquadDigest(input: {
  presentCount: number;
  totalSlots: number;
  flaggedCount: number;
}): TemplateResult {
  return {
    title: "Squad summary ready",
    body: `This week: ${input.presentCount}/${input.totalSlots} attendance records, ${input.flaggedCount} readiness flags.`,
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
    body: `${input.streakCount}-day ${input.goalTitle.toLowerCase()} streak. Keep it going.`,
    link: "/athlete/achievements",
  };
}

export function buildCoachFeedback(input: { coachName: string; preview: string }): TemplateResult {
  return {
    title: `Feedback from ${input.coachName}`,
    body: notificationPreview(input.preview),
    link: "/athlete/dashboard",
  };
}
