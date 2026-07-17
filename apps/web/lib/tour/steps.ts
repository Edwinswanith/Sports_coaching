// Step registry for the guided app tour — one source of truth per role.
// `id` doubles as the `data-tour` attribute value the overlay looks for.
// `action`, when present, is an id registered via `useTourAction` on the
// target page (e.g. an in-page tab switch) that runs right before the tour
// measures the target element.

import type { Role } from "../roles";

export type TourStepContext = {
  isAcademyOwner?: boolean;
};

export type TourStep = {
  id: string;
  route: string;
  action?: string;
  title: string;
  fallbackNote: string;
  /** When this returns true, skip the step entirely — and don't even navigate for it. */
  skipIf?: (ctx: TourStepContext) => boolean;
};

export const ATHLETE_TOUR_STEPS: TourStep[] = [
  {
    id: "athlete-hero",
    route: "/athlete/dashboard",
    title: "Your readiness ring",
    fallbackNote: "This ring is your daily readiness score — how ready your body is to train today, based on your check-in.",
  },
  {
    id: "athlete-legend",
    route: "/athlete/dashboard",
    title: "Colour key",
    fallbackNote: "Green means ready, amber means caution, red means prioritise recovery — this key applies everywhere in the app.",
  },
  {
    id: "athlete-stats",
    route: "/athlete/dashboard",
    title: "Quick stats",
    fallbackNote: "Sleep, recovery, and training load for today, at a glance.",
  },
  {
    id: "athlete-training-summary",
    route: "/athlete/dashboard",
    title: "Training summary",
    fallbackNote: "Your AM, afternoon, and PM sessions for today, and whether each is done.",
  },
  {
    id: "athlete-training-load",
    route: "/athlete/dashboard",
    title: "Training load",
    fallbackNote: "Your RPE-based training load and risk flag, calculated from your last logged session.",
  },
  {
    id: "athlete-progress-goals",
    route: "/athlete/dashboard",
    action: "athlete:section:progress",
    title: "Goals & streaks",
    fallbackNote: "Track streaks for check-ins, training, and hydration, and unlock rewards as you go.",
  },
  {
    id: "athlete-progress-water",
    route: "/athlete/dashboard",
    action: "athlete:progress:water",
    title: "Water tracking",
    fallbackNote: "Log your water intake and see progress toward your daily hydration goal.",
  },
  {
    id: "athlete-progress-trends",
    route: "/athlete/dashboard",
    action: "athlete:progress:trends",
    title: "Trends",
    fallbackNote: "Charts of your readiness, heart rate, wellness, and performance over time.",
  },
  {
    id: "athlete-log-hub",
    route: "/athlete/dashboard",
    action: "athlete:section:log",
    title: "Today's log",
    fallbackNote: "Log each session's status, workout details, and effort — this is where your day gets recorded.",
  },
  {
    id: "athlete-coach-updates",
    route: "/athlete/dashboard",
    action: "athlete:section:coach",
    title: "Coach updates",
    fallbackNote: "Announcements your coach has sent to the whole squad.",
  },
  {
    id: "athlete-coach-feedback",
    route: "/athlete/dashboard",
    title: "Coach feedback",
    fallbackNote: "Personal feedback your coach has left for you today.",
  },
  {
    id: "athlete-recent-activity",
    route: "/athlete/dashboard",
    title: "Recent activity",
    fallbackNote: "A timeline of everything logged recently — sessions, check-ins, and feedback.",
  },
  {
    id: "athlete-chat",
    route: "/athlete/messages",
    title: "Chat with your coach",
    fallbackNote: "Message your coach directly and see your conversation history here.",
  },
  {
    id: "athlete-ask-agent",
    route: "/athlete/dashboard",
    title: "Ask Agent",
    fallbackNote: "Tap here any time to ask the AI agent a question or log something by voice or text.",
  },
];

export const COACH_TOUR_STEPS: TourStep[] = [
  {
    id: "coach-kpi",
    route: "/coach/dashboard",
    title: "Squad KPIs",
    fallbackNote: "Athletes assigned, who's present, sessions completed, and average readiness — your squad at a glance.",
  },
  {
    id: "coach-attention",
    route: "/coach/dashboard",
    title: "Needs attention",
    fallbackNote: "Athletes flagged for injury, high risk, or low readiness — triage these first.",
  },
  {
    id: "coach-inbox",
    route: "/coach/dashboard",
    title: "Athlete messages",
    fallbackNote: "Unread replies from your athletes, surfaced here so nothing gets missed.",
  },
  {
    id: "coach-trend",
    route: "/coach/dashboard",
    title: "Squad trends",
    fallbackNote: "Analytics across your whole squad over time.",
  },
  {
    id: "coach-roster-list",
    route: "/coach/dashboard",
    title: "Full roster",
    fallbackNote: "Every assigned athlete — search, filter, and tap one to see their full daily card.",
  },
  {
    id: "coach-roster-page",
    route: "/coach/athletes",
    title: "Roster",
    fallbackNote: "The same roster as a dedicated page, with the same search and filters.",
  },
  {
    id: "coach-messages-page",
    route: "/coach/messages",
    title: "Messages",
    fallbackNote: "All your 1:1 conversation threads with athletes in one place.",
  },
  {
    id: "coach-announce-page",
    route: "/coach/announcements",
    title: "Announce",
    fallbackNote: "Broadcast one message to your whole squad at once.",
  },
  {
    id: "coach-coaches-page",
    route: "/coach/coaches",
    title: "Coaches",
    fallbackNote: "As the academy owner, add other coaches to your academy here.",
    skipIf: (ctx) => !ctx.isAcademyOwner,
  },
  {
    id: "coach-ask-agent",
    route: "/coach/dashboard",
    title: "Ask Agent",
    fallbackNote: "Tap here any time to ask the AI agent about your squad, by voice or text.",
  },
];

export const GUARDIAN_TOUR_STEPS: TourStep[] = [
  {
    id: "guardian-switcher",
    route: "/guardian/dashboard",
    title: "Switch athlete",
    fallbackNote: "If you have more than one linked athlete, switch between them here.",
  },
  {
    id: "guardian-sleep",
    route: "/guardian/dashboard",
    title: "Sleep",
    fallbackNote: "Your athlete's sleep quality and hours for the selected day.",
  },
  {
    id: "guardian-water",
    route: "/guardian/dashboard",
    title: "Water intake",
    fallbackNote: "How much water your athlete has logged against their daily goal.",
  },
  {
    id: "guardian-attendance",
    route: "/guardian/dashboard",
    title: "Attendance",
    fallbackNote: "Whether your athlete attended training today, with any note from the coach.",
  },
  {
    id: "guardian-ask-agent",
    route: "/guardian/dashboard",
    title: "Ask Agent",
    fallbackNote: "Ask the AI agent a question about your athlete any time.",
  },
];

export const TOUR_STEPS: Record<Role, TourStep[]> = {
  athlete: ATHLETE_TOUR_STEPS,
  coach: COACH_TOUR_STEPS,
  guardian: GUARDIAN_TOUR_STEPS,
};
