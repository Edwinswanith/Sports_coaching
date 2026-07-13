import { PERFORMANCE_METRICS } from "./analytics";
import type { AssistantConversationContext, AssistantTopic, DemoState, PerformanceMetric, ProgressRangeDays } from "./types";

const TOPICS: AssistantTopic[] = [
  "daily_status", "progress", "period_comparison", "best_day", "day_details", "coach_message", "coach_plan", "exercise", "intensity",
];
const METRICS: Array<AssistantConversationContext["metric"]> = [
  ...(Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[]), "readiness", "trainingCompletion",
];

export function sanitizeAssistantContext(value: unknown, state: DemoState): AssistantConversationContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const context: AssistantConversationContext = {};
  if (TOPICS.includes(source.topic as AssistantTopic)) context.topic = source.topic as AssistantTopic;
  if (([7, 14, 30] as number[]).includes(source.rangeDays as number)) context.rangeDays = source.rangeDays as ProgressRangeDays;
  if (isRecordedDate(source.rangeStart, state)) context.rangeStart = source.rangeStart;
  if (isRecordedDate(source.rangeEnd, state)) context.rangeEnd = source.rangeEnd;
  if (METRICS.includes(source.metric as AssistantConversationContext["metric"])) context.metric = source.metric as AssistantConversationContext["metric"];
  if (isRecordedDate(source.dateKey, state) || isPublishedPlanDate(source.dateKey, state)) context.dateKey = source.dateKey as string;
  const plan = typeof source.planId === "string"
    ? state.coachPlans.find((candidate) => candidate.id === source.planId && candidate.status === "published")
    : undefined;
  if (plan) {
    context.planId = plan.id;
    if (typeof source.exerciseId === "string" && plan.exercises.some((exercise) => exercise.id === source.exerciseId)) {
      context.exerciseId = source.exerciseId;
    }
  }
  return context;
}

function isRecordedDate(value: unknown, state: DemoState): value is string {
  return typeof value === "string" && state.days.some((day) => day.dateKey === value);
}

function isPublishedPlanDate(value: unknown, state: DemoState): value is string {
  return typeof value === "string" && state.coachPlans.some((plan) => plan.status === "published" && plan.dateKey === value);
}
