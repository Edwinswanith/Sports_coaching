import { PERFORMANCE_METRICS } from "./analytics";
import type {
  AssistantConversationContext,
  AssistantTopic,
  AthleteAnalyticsGoal,
  AthleteAnalyticsMetric,
  DemoState,
  PerformanceMetric,
  ProgressRangeDays,
} from "./types";

const TOPICS: AssistantTopic[] = [
  "daily_status", "progress", "period_comparison", "best_day", "day_details", "coach_message", "coach_plan", "exercise", "intensity", "analytics",
];
const METRICS: Array<AssistantConversationContext["metric"]> = [
  ...(Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[]), "readiness", "trainingCompletion",
];
const ANALYTICS_METRICS: AthleteAnalyticsMetric[] = [
  "readiness", "sleepHours", "sleepQuality", "mood", "soreness", "fatigue", "hydrationPercent",
  "trainingCompletion", "trainingLoad", ...(Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[]),
];
const ANALYTICS_GOALS: AthleteAnalyticsGoal[] = [
  "overview", "difficult_days", "strong_days", "trend", "relationship", "compare_periods",
];

export function sanitizeAssistantContext(value: unknown, state: DemoState): AssistantConversationContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const context: AssistantConversationContext = {};
  if (TOPICS.includes(source.topic as AssistantTopic)) context.topic = source.topic as AssistantTopic;
  if (([7, 14, 30] as number[]).includes(source.rangeDays as number)) context.rangeDays = source.rangeDays as ProgressRangeDays;
  if (isRecordedDate(source.rangeStart, state) && isRecordedDate(source.rangeEnd, state) && source.rangeStart <= source.rangeEnd) {
    context.rangeStart = source.rangeStart;
    context.rangeEnd = source.rangeEnd;
  }
  if (METRICS.includes(source.metric as AssistantConversationContext["metric"])) context.metric = source.metric as AssistantConversationContext["metric"];
  if (Array.isArray(source.metrics)) {
    const metrics = [...new Set(source.metrics.filter((metric): metric is AthleteAnalyticsMetric => ANALYTICS_METRICS.includes(metric as AthleteAnalyticsMetric)))].slice(0, 6);
    if (metrics.length) context.metrics = metrics;
  }
  if (ANALYTICS_GOALS.includes(source.analysisGoal as AthleteAnalyticsGoal)) context.analysisGoal = source.analysisGoal as AthleteAnalyticsGoal;
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
