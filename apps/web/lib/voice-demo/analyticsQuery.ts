import {
  PERFORMANCE_METRICS,
  calculateBenchmarkDeltas,
  calculatePeriodStats,
  formatBenchmarkDelta,
  formatDate,
  formatMetricValue,
} from "./analytics";
import type {
  AssistantConversationContext,
  AssistantEvidence,
  AthleteAnalyticsGoal,
  AthleteAnalyticsMetric,
  AthleteAnalyticsQuery,
  DemoDay,
  DemoState,
  PerformanceMetric,
  ProgressRangeDays,
} from "./types";

export const ATHLETE_ANALYTICS_METRICS: AthleteAnalyticsMetric[] = [
  "readiness",
  "sleepHours",
  "sleepQuality",
  "mood",
  "soreness",
  "fatigue",
  "hydrationPercent",
  "trainingCompletion",
  "trainingLoad",
  "sprint30m",
  "sprint100m",
  "verticalJump",
  "farmersWalk40m",
];

export const ATHLETE_ANALYTICS_GOALS: AthleteAnalyticsGoal[] = [
  "overview",
  "difficult_days",
  "strong_days",
  "trend",
  "relationship",
  "compare_periods",
];

const DEFAULT_DAILY_SIGNALS: AthleteAnalyticsMetric[] = [
  "readiness",
  "sleepQuality",
  "mood",
  "soreness",
  "fatigue",
  "hydrationPercent",
  "trainingCompletion",
];

const METRIC_CONFIG: Record<
  AthleteAnalyticsMetric,
  { label: string; favorable: "higher" | "lower" | "neutral"; decimals: number; suffix: string }
> = {
  readiness: { label: "Readiness", favorable: "higher", decimals: 0, suffix: "/100" },
  sleepHours: { label: "Sleep duration", favorable: "higher", decimals: 1, suffix: " h" },
  sleepQuality: { label: "Sleep quality", favorable: "higher", decimals: 1, suffix: "/10" },
  mood: { label: "Mood", favorable: "higher", decimals: 1, suffix: "/10" },
  soreness: { label: "Soreness", favorable: "lower", decimals: 1, suffix: "/10" },
  fatigue: { label: "Fatigue", favorable: "lower", decimals: 1, suffix: "/10" },
  hydrationPercent: { label: "Hydration goal progress", favorable: "higher", decimals: 0, suffix: "%" },
  trainingCompletion: { label: "Training completion", favorable: "higher", decimals: 0, suffix: "%" },
  trainingLoad: { label: "Training load", favorable: "neutral", decimals: 0, suffix: " AU" },
  sprint30m: { label: PERFORMANCE_METRICS.sprint30m.label, favorable: "lower", decimals: 2, suffix: " s" },
  sprint100m: { label: PERFORMANCE_METRICS.sprint100m.label, favorable: "lower", decimals: 2, suffix: " s" },
  verticalJump: { label: PERFORMANCE_METRICS.verticalJump.label, favorable: "higher", decimals: 0, suffix: " cm" },
  farmersWalk40m: { label: PERFORMANCE_METRICS.farmersWalk40m.label, favorable: "lower", decimals: 1, suffix: " s" },
};

export type AnalyticsGroundingFact = {
  id: string;
  label: string;
  value: string;
  dateKey?: string;
  text: string;
};

export type AthleteAnalyticsResult = {
  message: string;
  evidence: AssistantEvidence[];
  facts: AnalyticsGroundingFact[];
  suggestions: string[];
  context: AssistantConversationContext;
  coverage: { recordedDays: number; pairedObservations?: number; missingObservations: number };
  safetyDecision: string;
};

export type AnalyticsQueryValidation =
  | { ok: true; query: AthleteAnalyticsQuery }
  | { ok: false; kind: "clarification" | "unsupported"; message: string; options?: string[] };

export function validateAthleteAnalyticsQuery(
  value: Record<string, unknown>,
  state: DemoState,
): AnalyticsQueryValidation {
  const allowed = ["goal", "metrics", "rangeDays", "startDate", "endDate", "anchorDate", "limit"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    return { ok: false, kind: "unsupported", message: "That analysis included an unsupported query field, so I did not run it." };
  }
  if (!ATHLETE_ANALYTICS_GOALS.includes(value.goal as AthleteAnalyticsGoal)) {
    return {
      ok: false,
      kind: "clarification",
      message: "What would you like me to analyze: an overview, a difficult period, a strong period, a trend, or a relationship between two signals?",
      options: ["Show what stands out", "Find a difficult period", "Analyze a trend", "Compare two signals"],
    };
  }

  const goal = value.goal as AthleteAnalyticsGoal;
  const suppliedMetrics = Array.isArray(value.metrics) ? value.metrics : [];
  if (suppliedMetrics.some((metric) => !ATHLETE_ANALYTICS_METRICS.includes(metric as AthleteAnalyticsMetric))) {
    return { ok: false, kind: "unsupported", message: "That analysis requested a metric that is not available in the athlete history." };
  }
  const metrics = [...new Set(suppliedMetrics as AthleteAnalyticsMetric[])].slice(0, 6);
  if (goal === "relationship" && metrics.length !== 2) {
    return {
      ok: false,
      kind: "clarification",
      message: "Which two recorded signals should I compare? For example, sleep quality and readiness.",
      options: ["Sleep quality and readiness", "Fatigue and readiness", "Training load and soreness"],
    };
  }
  if ((goal === "difficult_days" || goal === "strong_days") && metrics.some((metric) => METRIC_CONFIG[metric].favorable === "neutral")) {
    return {
      ok: false,
      kind: "clarification",
      message: "Training load alone does not tell me whether a day was good or difficult. Should I compare load with readiness, soreness, or fatigue?",
      options: ["Training load and readiness", "Training load and soreness", "Training load and fatigue"],
    };
  }

  const rangeDays = ([7, 14, 30] as const).includes(value.rangeDays as ProgressRangeDays)
    ? value.rangeDays as ProgressRangeDays
    : undefined;
  const startDate = optionalDate(value.startDate);
  const endDate = optionalDate(value.endDate);
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return { ok: false, kind: "clarification", message: "Please provide both the start and end date for that analysis." };
  }
  if (startDate && endDate) {
    const availableStart = state.days[0]?.dateKey;
    const availableEnd = state.days.at(-1)?.dateKey;
    if (!availableStart || !availableEnd) {
      return { ok: false, kind: "unsupported", message: "I do not have recorded athlete history for that analysis, so I won’t create assumed values." };
    }
    if (startDate > endDate || startDate < availableStart || endDate > availableEnd) {
      return {
        ok: false,
        kind: "unsupported",
        message: `I only have athlete history from ${formatDate(availableStart)} to ${formatDate(availableEnd)}. I won’t fill missing dates with assumed values.`,
      };
    }
  }
  const anchorDate = optionalDate(value.anchorDate);
  if (anchorDate && !state.days.some((day) => day.dateKey === anchorDate)) {
    return { ok: false, kind: "unsupported", message: `I do not have recorded athlete data for ${formatDate(anchorDate)}, so I won’t invent an analysis around it.` };
  }
  const limit = Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 5 ? Number(value.limit) : 3;

  return {
    ok: true,
    query: {
      goal,
      metrics: metrics.length ? metrics : defaultMetrics(goal),
      ...(rangeDays ? { rangeDays } : {}),
      ...(startDate && endDate ? { startDate, endDate } : {}),
      ...(anchorDate ? { anchorDate } : {}),
      limit,
    },
  };
}

export function executeAthleteAnalyticsQuery(state: DemoState, query: AthleteAnalyticsQuery): AthleteAnalyticsResult {
  const days = selectDays(state, query);
  if (!days.length) return noDataResult(query, state);
  if (query.goal === "overview") return analyzeOverview(state, query, days);
  if (query.goal === "difficult_days" || query.goal === "strong_days") {
    return analyzeRankedDays(state, query, days, query.goal === "strong_days");
  }
  if (query.goal === "relationship") return analyzeRelationship(query, days);
  return analyzeTrend(query, days);
}

function analyzeOverview(state: DemoState, query: AthleteAnalyticsQuery, days: DemoDay[]): AthleteAnalyticsResult {
  const benchmarks = calculateBenchmarkDeltas(days);
  const stats = calculatePeriodStats(days);
  const facts: AnalyticsGroundingFact[] = [
    fact("E1", "Date range", `${formatDate(days[0].dateKey)} – ${formatDate(days.at(-1)!.dateKey)}`, undefined, `The reviewed range is ${formatDate(days[0].dateKey)} to ${formatDate(days.at(-1)!.dateKey)}`),
    fact("E2", "Average readiness", formatMetric("readiness", stats.averageReadiness), undefined, `Average readiness was ${formatMetric("readiness", stats.averageReadiness)}`),
    fact("E3", "Training completion", `${stats.trainingCompletionPercent}%`, undefined, `Training completion was ${stats.trainingCompletionPercent}%`),
    fact("E4", "Hydration goal reached", `${stats.hydrationGoalPercent}% of days`, undefined, `The hydration goal was reached on ${stats.hydrationGoalPercent}% of recorded days`),
    ...benchmarks.slice(0, 4).map((delta, index) => fact(
      `E${index + 5}`,
      PERFORMANCE_METRICS[delta.metric].label,
      formatBenchmarkDelta(delta),
      delta.lastDate,
      `${PERFORMANCE_METRICS[delta.metric].label} changed from ${formatMetricValue(delta.metric, delta.first)} to ${formatMetricValue(delta.metric, delta.last)}`,
    )),
  ];
  const improvements = benchmarks.filter((item) => item.improvement > 0).length;
  const message = `Your recorded performance moved in a positive direction across ${improvements} available benchmarks, and training completion was ${stats.trainingCompletionPercent}%. Hydration is the clearest consistency gap because the goal was reached on ${stats.hydrationGoalPercent}% of recorded days. This summary is calculated from the selected history rather than a stored progress label.`;
  return result(query, days, message, facts, ["Which days need a closer look?", "Did sleep quality move with readiness?", "Compare the first and second half."], {
    topic: "analytics", analysisGoal: query.goal, metrics: query.metrics, rangeStart: days[0].dateKey, rangeEnd: days.at(-1)!.dateKey,
  });
}

function analyzeRankedDays(state: DemoState, query: AthleteAnalyticsQuery, selectedDays: DemoDay[], favorable: boolean): AthleteAnalyticsResult {
  const rankingDays = selectedDays.filter((day) => day.dateKey !== state.athlete.dateKey);
  if (!rankingDays.length) return noDataResult(query, state);
  const ranked = rankDays(rankingDays, query.metrics, favorable).slice(0, query.limit);
  const primary = ranked[0];
  if (!primary) return noDataResult(query, state);
  const day = primary.day;
  const mode = favorable ? "strongest" : "most challenging";
  const facts: AnalyticsGroundingFact[] = [
    fact("E1", `${capitalize(mode)} recorded pattern`, formatDate(day.dateKey), day.dateKey, `${formatDate(day.dateKey)} had the ${mode} multi-signal pattern in the selected range`),
    ...query.metrics.flatMap((metric, index) => {
      const value = metricValue(day, metric);
      return value === null ? [] : [fact(`E${index + 2}`, METRIC_CONFIG[metric].label, formatMetric(metric, value), day.dateKey, `${METRIC_CONFIG[metric].label} was ${formatMetric(metric, value)} on ${formatDate(day.dateKey)}`)];
    }),
  ].slice(0, 8);
  const benchmarkCoverage = Object.keys(day.benchmarks ?? {}).length;
  if (!benchmarkCoverage) {
    facts.push(fact(`E${facts.length + 1}`, "Performance benchmark", "Not recorded that day", day.dateKey, `No sprint, jump, or timed-carry benchmark was recorded on ${formatDate(day.dateKey)}`));
  }
  const alternatives = ranked.slice(1).map((item) => formatDate(item.day.dateKey));
  const message = favorable
    ? `${formatDate(day.dateKey)} had the strongest recorded pattern across ${joinLabels(query.metrics)}. ${metricSentence(day, query.metrics)}${alternatives.length ? ` Other strong recorded dates were ${alternatives.join(" and ")}.` : ""} This is a runtime comparison of recorded signals, not a label stored on that day.`
    : `${formatDate(day.dateKey)} had the clearest challenging pattern across ${joinLabels(query.metrics)}. ${metricSentence(day, query.metrics)}${benchmarkCoverage ? "" : " No performance benchmark was recorded that day, so this conclusion is based on daily wellness, hydration, and training evidence rather than sprint performance."} This is a runtime comparison, not a stored “worst day” label.`;
  return result(query, selectedDays, message, facts, ["Why did that day stand out?", "What changed afterward?", "Compare sleep quality with readiness."], {
    topic: "analytics",
    analysisGoal: query.goal,
    metrics: query.metrics,
    metric: query.metrics.length === 1 && isLegacyMetric(query.metrics[0]) ? query.metrics[0] : undefined,
    dateKey: day.dateKey,
    rangeStart: selectedDays[0].dateKey,
    rangeEnd: selectedDays.at(-1)!.dateKey,
  });
}

function analyzeRelationship(query: AthleteAnalyticsQuery, days: DemoDay[]): AthleteAnalyticsResult {
  const [firstMetric, secondMetric] = query.metrics;
  const pairs = days.flatMap((day) => {
    const first = metricValue(day, firstMetric);
    const second = metricValue(day, secondMetric);
    return first === null || second === null ? [] : [{ day, first, second }];
  });
  if (pairs.length < 5) {
    const message = `Only ${pairs.length} paired observations are available for ${METRIC_CONFIG[firstMetric].label.toLowerCase()} and ${METRIC_CONFIG[secondMetric].label.toLowerCase()}. That is not enough for a useful relationship check, so I won’t infer a pattern.`;
    return result(query, days, message, [fact("E1", "Paired observations", String(pairs.length), undefined, `${pairs.length} paired observations were available`)], ["Show my overall progress", "Choose two daily wellness signals"], {
      topic: "analytics", analysisGoal: query.goal, metrics: query.metrics, rangeStart: days[0].dateKey, rangeEnd: days.at(-1)!.dateKey,
    }, pairs.length);
  }
  const coefficient = pearson(pairs.map((pair) => pair.first), pairs.map((pair) => pair.second));
  const strength = Math.abs(coefficient) >= 0.7 ? "strong" : Math.abs(coefficient) >= 0.4 ? "moderate" : Math.abs(coefficient) >= 0.2 ? "weak" : "little";
  const movement = coefficient > 0.05 ? "moved in the same direction" : coefficient < -0.05 ? "moved in opposite directions" : "showed little consistent movement together";
  const facts = [
    fact("E1", "Paired observations", String(pairs.length), undefined, `${pairs.length} paired daily observations were available`),
    fact("E2", "Relationship", `${strength} · r=${coefficient.toFixed(2)}`, undefined, `The calculated relationship was ${strength}, with coefficient ${coefficient.toFixed(2)}`),
    fact("E3", METRIC_CONFIG[firstMetric].label, `${formatMetric(firstMetric, average(pairs.map((pair) => pair.first)))} average`, undefined, `${METRIC_CONFIG[firstMetric].label} averaged ${formatMetric(firstMetric, average(pairs.map((pair) => pair.first)))}`),
    fact("E4", METRIC_CONFIG[secondMetric].label, `${formatMetric(secondMetric, average(pairs.map((pair) => pair.second)))} average`, undefined, `${METRIC_CONFIG[secondMetric].label} averaged ${formatMetric(secondMetric, average(pairs.map((pair) => pair.second)))}`),
  ];
  const message = `Across ${pairs.length} paired days, ${METRIC_CONFIG[firstMetric].label.toLowerCase()} and ${METRIC_CONFIG[secondMetric].label.toLowerCase()} ${movement}; the calculated relationship was ${strength} (r=${coefficient.toFixed(2)}). This is an association in the recorded data, not proof that one signal caused the other.`;
  return result(query, days, message, facts, ["Show the days behind this pattern", "Compare the first and second half", "What should I discuss with Coach Priya?"], {
    topic: "analytics", analysisGoal: query.goal, metrics: query.metrics, rangeStart: days[0].dateKey, rangeEnd: days.at(-1)!.dateKey,
  }, pairs.length);
}

function analyzeTrend(query: AthleteAnalyticsQuery, days: DemoDay[]): AthleteAnalyticsResult {
  if (days.length < 4) return noDataResult(query, { days } as DemoState);
  const anchorIndex = query.anchorDate ? days.findIndex((day) => day.dateKey === query.anchorDate) : -1;
  const midpoint = Math.floor(days.length / 2);
  const first = anchorIndex >= 0 ? days.slice(Math.max(0, anchorIndex - 7), anchorIndex) : days.slice(0, midpoint);
  const second = anchorIndex >= 0 ? days.slice(anchorIndex + 1, anchorIndex + 8) : days.slice(-midpoint);
  if (first.length < 2 || second.length < 2) return noDataResult(query, { days } as DemoState);
  const metrics = query.metrics.length ? query.metrics : DEFAULT_DAILY_SIGNALS;
  const facts: AnalyticsGroundingFact[] = [
    fact("E1", "First period", `${formatDate(first[0].dateKey)} – ${formatDate(first.at(-1)!.dateKey)}`, undefined, `The first comparison period is ${formatDate(first[0].dateKey)} to ${formatDate(first.at(-1)!.dateKey)}`),
    fact("E2", "Second period", `${formatDate(second[0].dateKey)} – ${formatDate(second.at(-1)!.dateKey)}`, undefined, `The second comparison period is ${formatDate(second[0].dateKey)} to ${formatDate(second.at(-1)!.dateKey)}`),
  ];
  const changes = metrics.flatMap((metric, index) => {
    const firstAverage = average(first.flatMap((day) => metricValue(day, metric) ?? []));
    const secondAverage = average(second.flatMap((day) => metricValue(day, metric) ?? []));
    if (firstAverage === null || secondAverage === null) return [];
    const change = round(secondAverage - firstAverage, 2);
    facts.push(fact(
      `E${index + 3}`,
      METRIC_CONFIG[metric].label,
      `${formatMetric(metric, firstAverage)} → ${formatMetric(metric, secondAverage)}`,
      undefined,
      `${METRIC_CONFIG[metric].label} changed from ${formatMetric(metric, firstAverage)} to ${formatMetric(metric, secondAverage)}`,
    ));
    return [{ metric, firstAverage, secondAverage, change }];
  });
  if (!changes.length) return noDataResult(query, { days } as DemoState);
  const descriptions = changes.map(({ metric, firstAverage, secondAverage }) => `${METRIC_CONFIG[metric].label.toLowerCase()} ${formatMetric(metric, firstAverage)} → ${formatMetric(metric, secondAverage)}`);
  const message = `I compared ${formatDate(first[0].dateKey)}–${formatDate(first.at(-1)!.dateKey)} with ${formatDate(second[0].dateKey)}–${formatDate(second.at(-1)!.dateKey)}. ${descriptions.join("; ")}. These are calculated period changes; they do not by themselves establish why a metric changed.`;
  return result(query, days, message, facts, ["Which day needs a closer look?", "Check sleep quality against readiness", "Show my overall progress"], {
    topic: "analytics", analysisGoal: query.goal, metrics, rangeStart: days[0].dateKey, rangeEnd: days.at(-1)!.dateKey,
  });
}

function rankDays(days: DemoDay[], metrics: AthleteAnalyticsMetric[], favorable: boolean) {
  const scores = new Map<string, { day: DemoDay; total: number; count: number }>();
  for (const day of days) scores.set(day.dateKey, { day, total: 0, count: 0 });
  for (const metric of metrics) {
    const config = METRIC_CONFIG[metric];
    const observations = days.flatMap((day) => {
      const value = metricValue(day, metric);
      return value === null ? [] : [{ day, value }];
    });
    if (observations.length < 2 || config.favorable === "neutral") continue;
    const targetHigher = favorable ? config.favorable === "higher" : config.favorable === "lower";
    const sorted = [...observations].sort((a, b) => targetHigher ? b.value - a.value : a.value - b.value);
    const denominator = Math.max(1, sorted.length - 1);
    for (const observation of observations) {
      const firstMatchingRank = sorted.findIndex((candidate) => candidate.value === observation.value);
      const percentileScore = 1 - firstMatchingRank / denominator;
      const score = scores.get(observation.day.dateKey)!;
      score.total += percentileScore;
      score.count += 1;
    }
  }
  return [...scores.values()]
    .filter((item) => item.count >= Math.min(2, metrics.length))
    .map((item) => ({ ...item, score: item.total / item.count }))
    .sort((a, b) => b.score - a.score || (a.day.readiness ?? 101) - (b.day.readiness ?? 101) || a.day.dateKey.localeCompare(b.day.dateKey));
}

function metricValue(day: DemoDay, metric: AthleteAnalyticsMetric): number | null {
  if (metric === "readiness") return day.readiness;
  if (metric === "sleepHours") return day.wellness.sleepHours;
  if (metric === "sleepQuality" || metric === "mood" || metric === "soreness" || metric === "fatigue") return day.wellness[metric];
  if (metric === "hydrationPercent") return day.hydration.goalMl ? Math.round((day.hydration.totalMl / day.hydration.goalMl) * 100) : null;
  if (metric === "trainingCompletion") {
    if (!day.sessions.length) return null;
    return Math.round((day.sessions.filter((session) => session.status === "completed").length / day.sessions.length) * 100);
  }
  if (metric === "trainingLoad") return day.sessions.reduce((total, session) => total + (session.sessionLoad ?? 0), 0);
  return day.benchmarks?.[metric] ?? null;
}

function selectDays(state: DemoState, query: AthleteAnalyticsQuery) {
  const ordered = [...state.days].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (query.startDate && query.endDate) return ordered.filter((day) => day.dateKey >= query.startDate! && day.dateKey <= query.endDate!);
  return ordered.slice(-(query.rangeDays ?? 30));
}

function result(
  query: AthleteAnalyticsQuery,
  days: DemoDay[],
  message: string,
  facts: AnalyticsGroundingFact[],
  suggestions: string[],
  context: AssistantConversationContext,
  pairedObservations?: number,
): AthleteAnalyticsResult {
  const possible = days.length * query.metrics.length;
  const recorded = days.reduce((total, day) => total + query.metrics.filter((metric) => metricValue(day, metric) !== null).length, 0);
  return {
    message,
    evidence: facts.map(({ label, value, dateKey }) => ({ label, value, ...(dateKey ? { dateKey } : {}) })),
    facts,
    suggestions,
    context,
    coverage: { recordedDays: days.length, ...(pairedObservations !== undefined ? { pairedObservations } : {}), missingObservations: Math.max(0, possible - recorded) },
    safetyDecision: "Read-only typed query executed against recorded athlete data; no default values, writes, causal claims, or training prescription were permitted.",
  };
}

function noDataResult(query: AthleteAnalyticsQuery, state: Pick<DemoState, "days">): AthleteAnalyticsResult {
  const start = state.days[0]?.dateKey;
  const end = state.days.at(-1)?.dateKey;
  const message = start && end
    ? `I could not find enough recorded values for that analysis between ${formatDate(start)} and ${formatDate(end)}. I won’t replace missing observations with defaults.`
    : "I could not find recorded athlete data for that analysis, and I won’t create default values.";
  return {
    message,
    evidence: [],
    facts: [],
    suggestions: ["Show my overall progress", "Choose a recorded metric"],
    context: { topic: "analytics", analysisGoal: query.goal, metrics: query.metrics },
    coverage: { recordedDays: state.days.length, missingObservations: state.days.length * query.metrics.length },
    safetyDecision: "Analysis stopped because supporting observations were unavailable; no values were invented.",
  };
}

function defaultMetrics(goal: AthleteAnalyticsGoal): AthleteAnalyticsMetric[] {
  if (goal === "overview") return ["readiness", "trainingCompletion", "hydrationPercent", "sprint30m", "sprint100m", "verticalJump", "farmersWalk40m"];
  if (goal === "trend" || goal === "compare_periods") return ["readiness", "sleepQuality", "fatigue", "hydrationPercent", "trainingCompletion"];
  return DEFAULT_DAILY_SIGNALS;
}

function fact(id: string, label: string, value: string, dateKey: string | undefined, text: string): AnalyticsGroundingFact {
  return { id, label, value, ...(dateKey ? { dateKey } : {}), text };
}

function optionalDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function isLegacyMetric(metric: AthleteAnalyticsMetric): metric is PerformanceMetric | "readiness" | "trainingCompletion" {
  return metric === "readiness" || metric === "trainingCompletion" || metric in PERFORMANCE_METRICS;
}

function formatMetric(metric: AthleteAnalyticsMetric, value: number | null) {
  if (value === null) return "not recorded";
  const config = METRIC_CONFIG[metric];
  return `${value.toFixed(config.decimals)}${config.suffix}`;
}

function metricSentence(day: DemoDay, metrics: AthleteAnalyticsMetric[]) {
  return metrics.flatMap((metric) => {
    const value = metricValue(day, metric);
    return value === null ? [] : [`${METRIC_CONFIG[metric].label} was ${formatMetric(metric, value)}`];
  }).join(", ") + ".";
}

function joinLabels(metrics: AthleteAnalyticsMetric[]) {
  const labels = metrics.map((metric) => METRIC_CONFIG[metric].label.toLowerCase());
  if (labels.length < 2) return labels[0] ?? "recorded data";
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function pearson(xs: number[], ys: number[]) {
  const xAverage = average(xs) ?? 0;
  const yAverage = average(ys) ?? 0;
  let numerator = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const xDelta = xs[index] - xAverage;
    const yDelta = ys[index] - yAverage;
    numerator += xDelta * yDelta;
    xSum += xDelta ** 2;
    ySum += yDelta ** 2;
  }
  const denominator = Math.sqrt(xSum * ySum);
  return denominator ? round(numerator / denominator, 2) : 0;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
