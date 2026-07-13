import type {
  AssistantEvidence,
  DemoCoachWorkoutPlan,
  DemoDay,
  DemoPerformanceBenchmarks,
  DemoState,
  PerformanceMetric,
  ProgressRangeDays,
} from "./types";

export const PERFORMANCE_METRICS: Record<
  PerformanceMetric,
  { label: string; unit: string; direction: "lower" | "higher"; decimals: number }
> = {
  sprint30m: { label: "30 m sprint", unit: "s", direction: "lower", decimals: 2 },
  sprint100m: { label: "100 m sprint", unit: "s", direction: "lower", decimals: 2 },
  verticalJump: { label: "Vertical jump", unit: "cm", direction: "higher", decimals: 0 },
  farmersWalk40m: { label: "Farmer’s walk 40 m", unit: "s", direction: "lower", decimals: 1 },
};

export type PeriodStats = {
  startDate: string;
  endDate: string;
  recordedDays: number;
  averageReadiness: number | null;
  averageWellness: number | null;
  averageSoreness: number | null;
  averageFatigue: number | null;
  trainingCompletionPercent: number;
  hydrationGoalPercent: number;
  totalSessionLoad: number;
};

export type BenchmarkDelta = {
  metric: PerformanceMetric;
  first: number;
  last: number;
  rawDelta: number;
  improvement: number;
  firstDate: string;
  lastDate: string;
};

export type ProgressSummary = {
  rangeDays: ProgressRangeDays;
  startDate: string;
  endDate: string;
  stats: PeriodStats;
  benchmarks: BenchmarkDelta[];
  priorities: string[];
  evidence: AssistantEvidence[];
};

export function getProgressSummary(state: DemoState, rangeDays: ProgressRangeDays = 30): ProgressSummary {
  const days = getDaysForRange(state, rangeDays);
  const stats = calculatePeriodStats(days);
  const benchmarks = calculateBenchmarkDeltas(days);
  const priorities = calculateProgressPriorities(state, days, benchmarks);
  return {
    rangeDays,
    startDate: stats.startDate,
    endDate: stats.endDate,
    stats,
    benchmarks,
    priorities,
    evidence: [
      { label: "Date range", value: `${formatDate(stats.startDate)} – ${formatDate(stats.endDate)}` },
      { label: "Average readiness", value: formatNullable(stats.averageReadiness, "/100") },
      { label: "Training completion", value: `${stats.trainingCompletionPercent}%` },
      { label: "Hydration goal reached", value: `${stats.hydrationGoalPercent}% of days` },
      { label: "Training load", value: `${stats.totalSessionLoad.toLocaleString("en-IN")} AU` },
      ...benchmarks.map((delta) => ({
        label: PERFORMANCE_METRICS[delta.metric].label,
        value: formatBenchmarkDelta(delta),
        dateKey: delta.lastDate,
      })),
    ],
  };
}

export function compareFirstAndLastTwoWeeks(state: DemoState) {
  const ordered = [...state.days].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const first = calculatePeriodStats(ordered.slice(0, 14));
  const last = calculatePeriodStats(ordered.slice(-14));
  return {
    first,
    last,
    deltas: {
      readiness: nullableDelta(last.averageReadiness, first.averageReadiness),
      wellness: nullableDelta(last.averageWellness, first.averageWellness),
      soreness: nullableDelta(last.averageSoreness, first.averageSoreness),
      fatigue: nullableDelta(last.averageFatigue, first.averageFatigue),
      completion: last.trainingCompletionPercent - first.trainingCompletionPercent,
      hydration: last.hydrationGoalPercent - first.hydrationGoalPercent,
      trainingLoad: last.totalSessionLoad - first.totalSessionLoad,
    },
    evidence: [
      { label: "First period", value: `${formatDate(first.startDate)} – ${formatDate(first.endDate)}` },
      { label: "Last period", value: `${formatDate(last.startDate)} – ${formatDate(last.endDate)}` },
      { label: "Readiness", value: `${formatNullable(first.averageReadiness, "/100")} → ${formatNullable(last.averageReadiness, "/100")}` },
      { label: "Training completion", value: `${first.trainingCompletionPercent}% → ${last.trainingCompletionPercent}%` },
      { label: "Hydration goal days", value: `${first.hydrationGoalPercent}% → ${last.hydrationGoalPercent}%` },
      { label: "Average soreness", value: `${formatNullable(first.averageSoreness, "/10")} → ${formatNullable(last.averageSoreness, "/10")}` },
      { label: "Average fatigue", value: `${formatNullable(first.averageFatigue, "/10")} → ${formatNullable(last.averageFatigue, "/10")}` },
    ] satisfies AssistantEvidence[],
  };
}

export function findBestDay(
  state: DemoState,
  metric: PerformanceMetric | "readiness" | "trainingCompletion",
): { days: DemoDay[]; value: number; evidence: AssistantEvidence[] } | null {
  const valued = state.days.flatMap((day) => {
    if (metric === "readiness") return day.readiness === null ? [] : [{ day, value: day.readiness }];
    if (metric === "trainingCompletion") {
      if (!day.sessions.length) return [];
      const completed = day.sessions.filter((session) => session.status === "completed").length;
      return [{ day, value: Math.round((completed / day.sessions.length) * 100) }];
    }
    const value = day.benchmarks?.[metric];
    return value === undefined ? [] : [{ day, value }];
  });
  if (!valued.length) return null;
  const direction = metric === "readiness" || metric === "trainingCompletion" || PERFORMANCE_METRICS[metric].direction === "higher"
    ? "higher"
    : "lower";
  const bestValue = direction === "higher"
    ? Math.max(...valued.map((item) => item.value))
    : Math.min(...valued.map((item) => item.value));
  const days = valued.filter((item) => item.value === bestValue).map((item) => item.day);
  const label = metric === "readiness"
    ? "Readiness"
    : metric === "trainingCompletion"
      ? "Training completion"
      : PERFORMANCE_METRICS[metric].label;
  const formatted = metric === "readiness"
    ? `${bestValue}/100`
    : metric === "trainingCompletion"
      ? `${bestValue}%`
      : formatMetricValue(metric, bestValue);
  return {
    days,
    value: bestValue,
    evidence: days.map((day) => ({ label, value: formatted, dateKey: day.dateKey })),
  };
}

export function getDayDetails(state: DemoState, dateKey: string): DemoDay | null {
  return state.days.find((day) => day.dateKey === dateKey) ?? null;
}

export function getPublishedCoachPlan(state: DemoState, dateKey: string): DemoCoachWorkoutPlan | null {
  return [...state.coachPlans]
    .filter((plan) => plan.dateKey === dateKey && plan.status === "published")
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function getLatestPublishedCoachPlan(state: DemoState): DemoCoachWorkoutPlan | null {
  return [...state.coachPlans]
    .filter((plan) => plan.status === "published")
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.version - a.version)[0] ?? null;
}

export function findPublishedExercise(
  state: DemoState,
  planId: string | undefined,
  reference: string,
): { plan: DemoCoachWorkoutPlan; exercise: DemoCoachWorkoutPlan["exercises"][number] } | null {
  const plan = planId
    ? state.coachPlans.find((candidate) => candidate.id === planId && candidate.status === "published") ?? null
    : getLatestPublishedCoachPlan(state);
  if (!plan) return null;
  const normalized = normalizeExerciseReference(reference);
  const exercise = plan.exercises.find((candidate) => normalizeExerciseReference(candidate.name).includes(normalized));
  return exercise ? { plan, exercise } : null;
}

export function exerciseEvidence(
  exercise: DemoCoachWorkoutPlan["exercises"][number],
  dateKey: string,
): AssistantEvidence[] {
  return [
    { label: "Exercise", value: exercise.name, dateKey },
    { label: "Volume", value: exercise.reps !== undefined ? `${exercise.sets} × ${exercise.reps} reps` : `${exercise.sets} × ${exercise.distanceMeters} m` },
    { label: "Load", value: `${exercise.loadKg} kg${exercise.loadLabel ? ` ${exercise.loadLabel}` : ""}` },
    { label: "Target effort", value: `RPE ${exercise.targetRpe}/10` },
    { label: "Rest", value: `${exercise.restSeconds} seconds` },
  ];
}

export function calculatePeriodStats(days: DemoDay[]): PeriodStats {
  if (!days.length) throw new Error("Cannot calculate an empty demo period.");
  const readiness = days.flatMap((day) => day.readiness === null ? [] : [day.readiness]);
  const wellness = days.flatMap((day) => day.readiness === null ? [] : [day.readiness / 10]);
  const soreness = days.flatMap((day) => day.wellness.soreness === null ? [] : [day.wellness.soreness]);
  const fatigue = days.flatMap((day) => day.wellness.fatigue === null ? [] : [day.wellness.fatigue]);
  const sessions = days.flatMap((day) => day.sessions);
  const completed = sessions.filter((session) => session.status === "completed").length;
  const hydrationRecorded = days.filter((day) => day.hydration.goalMl > 0);
  const hydrationReached = hydrationRecorded.filter((day) => day.hydration.totalMl >= day.hydration.goalMl).length;
  return {
    startDate: days[0].dateKey,
    endDate: days.at(-1)!.dateKey,
    recordedDays: days.length,
    averageReadiness: average(readiness),
    averageWellness: average(wellness),
    averageSoreness: average(soreness),
    averageFatigue: average(fatigue),
    trainingCompletionPercent: sessions.length ? Math.round((completed / sessions.length) * 100) : 0,
    hydrationGoalPercent: hydrationRecorded.length ? Math.round((hydrationReached / hydrationRecorded.length) * 100) : 0,
    totalSessionLoad: sessions.reduce((total, session) => total + (session.sessionLoad ?? 0), 0),
  };
}

export function calculateBenchmarkDeltas(days: DemoDay[]): BenchmarkDelta[] {
  return (Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[]).flatMap((metric) => {
    const observations = days.flatMap((day) => {
      const value = day.benchmarks?.[metric];
      return value === undefined ? [] : [{ value, dateKey: day.dateKey }];
    });
    if (observations.length < 2) return [];
    const first = observations[0];
    const last = observations.at(-1)!;
    const rawDelta = roundMetric(last.value - first.value);
    const improvement = roundMetric(PERFORMANCE_METRICS[metric].direction === "lower" ? -rawDelta : rawDelta);
    return [{ metric, first: first.value, last: last.value, rawDelta, improvement, firstDate: first.dateKey, lastDate: last.dateKey }];
  });
}

export function calculateProgressPriorities(
  state: DemoState,
  rangeDays: DemoDay[] = getDaysForRange(state, 30),
  benchmarks = calculateBenchmarkDeltas(rangeDays),
): string[] {
  const stats = calculatePeriodStats(rangeDays);
  const priorities: string[] = [];
  if (stats.averageWellness !== null && stats.averageWellness < 6) {
    priorities.push(`Wellness averaged ${stats.averageWellness.toFixed(1)}/10, below the 6/10 review threshold.`);
  }
  const recorded = state.days.filter((day) => day.readiness !== null);
  const previousSeven = calculatePeriodStats(recorded.slice(-14, -7));
  const recentSeven = calculatePeriodStats(recorded.slice(-7));
  if (
    previousSeven.averageSoreness !== null && recentSeven.averageSoreness !== null &&
    recentSeven.averageSoreness - previousSeven.averageSoreness >= 1
  ) {
    priorities.push(`Soreness rose by ${(recentSeven.averageSoreness - previousSeven.averageSoreness).toFixed(1)} points between the last two seven-day periods.`);
  }
  if (
    previousSeven.averageFatigue !== null && recentSeven.averageFatigue !== null &&
    recentSeven.averageFatigue - previousSeven.averageFatigue >= 1
  ) {
    priorities.push(`Fatigue rose by ${(recentSeven.averageFatigue - previousSeven.averageFatigue).toFixed(1)} points between the last two seven-day periods.`);
  }
  if (stats.trainingCompletionPercent < 85) {
    priorities.push(`Training completion was ${stats.trainingCompletionPercent}%, below the 85% review threshold.`);
  }
  if (stats.hydrationGoalPercent < 70) {
    priorities.push(`The hydration goal was reached on ${stats.hydrationGoalPercent}% of days, below the 70% review threshold.`);
  }
  for (const delta of benchmarks.filter((item) => item.improvement < 0)) {
    priorities.push(`${PERFORMANCE_METRICS[delta.metric].label} declined by ${formatAbsoluteMetricDelta(delta.metric, Math.abs(delta.improvement))}.`);
  }
  if (!priorities.length) {
    priorities.push("No threshold-based concern was triggered; continue recording consistently and follow Coach Priya’s published plan.");
  }
  return priorities;
}

export function getDaysForRange(state: DemoState, rangeDays: ProgressRangeDays): DemoDay[] {
  return [...state.days].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).slice(-rangeDays);
}

export function formatMetricValue(metric: PerformanceMetric, value: number) {
  const config = PERFORMANCE_METRICS[metric];
  return `${value.toFixed(config.decimals)} ${config.unit}`;
}

export function formatBenchmarkDelta(delta: BenchmarkDelta) {
  const arrow = `${formatMetricValue(delta.metric, delta.first)} → ${formatMetricValue(delta.metric, delta.last)}`;
  const direction = delta.improvement >= 0 ? "improved" : "declined";
  return `${arrow} (${direction} ${formatAbsoluteMetricDelta(delta.metric, Math.abs(delta.improvement))})`;
}

export function formatDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateKey}T00:00:00.000Z`),
  );
}

export function formatPlanDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${dateKey}T00:00:00.000Z`),
  );
}

export function benchmarkValues(day: DemoDay): Array<{ metric: PerformanceMetric; value: number }> {
  return (Object.entries(day.benchmarks ?? {}) as Array<[PerformanceMetric, number]>).map(([metric, value]) => ({ metric, value }));
}

function formatAbsoluteMetricDelta(metric: PerformanceMetric, value: number) {
  const config = PERFORMANCE_METRICS[metric];
  return `${value.toFixed(config.decimals)} ${config.unit}`;
}

function average(values: number[]) {
  if (!values.length) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

function nullableDelta(current: number | null, previous: number | null) {
  return current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatNullable(value: number | null, suffix: string) {
  return value === null ? "Not recorded" : `${value.toFixed(1)}${suffix}`;
}

function normalizeExerciseReference(value: string) {
  return value.toLowerCase().replace(/[’']/g, "").replace(/farmers?\s+(?:walk|carry)/, "farmers walk").replace(/slide/, "sled").trim();
}

export function mergeBenchmarks(days: DemoDay[]): DemoPerformanceBenchmarks {
  return days.reduce<DemoPerformanceBenchmarks>((result, day) => ({ ...result, ...day.benchmarks }), {});
}
