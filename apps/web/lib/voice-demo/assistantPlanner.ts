import { randomUUID } from "node:crypto";
import type { AssistantCandidate, AssistantInterpretation } from "./assistantInterpreter";
import { executeAthleteAnalyticsQuery, validateAthleteAnalyticsQuery } from "./analyticsQuery";
import {
  PERFORMANCE_METRICS,
  compareFirstAndLastTwoWeeks,
  exerciseEvidence,
  findBestDay,
  findPublishedExercise,
  formatBenchmarkDelta,
  formatDate,
  formatMetricValue,
  formatPlanDate,
  getDayDetails,
  getLatestPublishedCoachPlan,
  getProgressSummary,
  getPublishedCoachPlan,
} from "./analytics";
import {
  getActiveDemoDay,
  type AssistantConversationContext,
  type AssistantEvidence,
  type AssistantTurnResponse,
  type DemoAssistantPlan,
  type DemoDay,
  type DemoSession,
  type DemoState,
  type DemoToolCall,
  type PerformanceMetric,
  type ProgressRangeDays,
  type RecoveryModality,
  type WellnessKey,
} from "./types";

export type ResolvedAssistantTurn = { response: AssistantTurnResponse; plan?: DemoAssistantPlan };

const WELLNESS_KEYS: WellnessKey[] = ["sleepQuality", "mood", "soreness", "fatigue"];
const PERFORMANCE_KEYS = Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[];
const RECOVERY_MAP: Record<string, RecoveryModality> = {
  stretching: "Stretching", mobility: "Mobility", "ice bath": "Ice bath", ice_bath: "Ice bath", physio: "Physio",
};

export function resolveAssistantCandidates(
  state: DemoState,
  interpretation: AssistantInterpretation,
  previousContext: AssistantConversationContext = {},
  now = new Date(),
): ResolvedAssistantTurn {
  const { candidates, debug } = interpretation;
  if (candidates.length > 1) {
    const options = candidates.map((candidate) => candidateLabel(candidate.tool));
    return reply("clarification", `I heard ${options.length} actions: ${joinList(options)}. Please handle one at a time in this demo.`, debug, previousContext, { options });
  }
  const candidate = candidates[0];
  if (!candidate) return unsupported("I couldn’t identify an athlete action in that request.", debug, previousContext);

  const readOnly = resolveReadOnlyCandidate(state, candidate, interpretation, previousContext);
  if (readOnly) return readOnly;
  if (candidate.tool === "unsupported") {
    return unsupported(
      "I can help with daily status, 30-day progress, comparisons, best days, Coach Priya’s plan, water, wellness, training, recovery, or a coach message.",
      debug,
      previousContext,
    );
  }

  try {
    const proposalCandidate = candidate.tool === "update_training_session" && candidate.arguments.sessionReference === undefined
      ? {
          ...candidate,
          arguments: {
            ...candidate.arguments,
            ...(explicitSessionReference(debug.normalizedQuery ?? "") ? { sessionReference: explicitSessionReference(debug.normalizedQuery ?? "") } : {}),
          },
        }
      : candidate;
    const proposal = buildToolProposal(state, proposalCandidate);
    if ("clarification" in proposal) {
      return reply("clarification", proposal.clarification, debug, previousContext, { options: proposal.options });
    }
    if ("unsupported" in proposal) return unsupported(proposal.unsupported, debug, previousContext);
    const planId = `plan_${randomUUID()}`;
    const plan: DemoAssistantPlan = {
      id: planId,
      status: "proposed",
      summary: proposal.summary,
      displayFields: proposal.displayFields,
      toolCall: { ...proposal.toolCall, operationId: `assistant_${planId}` } as DemoToolCall,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    };
    return {
      plan,
      response: {
        kind: "plan",
        message: "Review this proposed update before saving.",
        plan: { id: plan.id, tool: plan.toolCall.tool, summary: plan.summary, displayFields: plan.displayFields, expiresAt: plan.expiresAt },
        context: previousContext,
        debug: { ...debug, context: previousContext, safetyDecision: "Write withheld until explicit confirmation." },
      },
    };
  } catch {
    return unsupported("I couldn’t safely validate that request. Try a more specific command or use manual entry.", debug, previousContext);
  }
}

function resolveReadOnlyCandidate(
  state: DemoState,
  candidate: AssistantCandidate,
  interpretation: AssistantInterpretation,
  previousContext: AssistantConversationContext,
): ResolvedAssistantTurn | null {
  const { debug } = interpretation;
  if (candidate.tool === "get_daily_status") {
    const day = getActiveDemoDay(state);
    const evidence = dailyStatusEvidence(day);
    return reply("answer", dailyStatusMessage(day), debug, { topic: "daily_status", dateKey: day.dateKey }, { evidence, suggestions: ["How did I progress this month?", "What has Coach Priya planned for Monday?"] });
  }
  if (candidate.tool === "get_progress_summary") {
    assertOnlyKeys(candidate.arguments, ["rangeDays"]);
    const rangeDays = ([7, 14, 30] as const).includes(candidate.arguments.rangeDays as ProgressRangeDays)
      ? candidate.arguments.rangeDays as ProgressRangeDays
      : 30;
    const summary = getProgressSummary(state, rangeDays);
    const prioritiesOnly = /what.*improve|should i improve|focus on/.test(debug.normalizedQuery ?? "");
    const message = prioritiesOnly ? progressPrioritiesMessage(summary) : progressSummaryMessage(summary);
    const context: AssistantConversationContext = {
      topic: "progress", rangeDays, rangeStart: summary.startDate, rangeEnd: summary.endDate,
    };
    return reply("answer", message, debug, context, {
      evidence: summary.evidence,
      suggestions: ["Compare my first two weeks with my last two weeks.", "Which day had my best readiness?", "What should I improve?"],
      safetyDecision: "Analysis is calculated from stored demo data; no training change was prescribed.",
    });
  }
  if (candidate.tool === "analyze_athlete_data") {
    const validation = validateAthleteAnalyticsQuery(candidate.arguments, state);
    if (!validation.ok) {
      return validation.kind === "clarification"
        ? reply("clarification", validation.message, debug, previousContext, { options: validation.options })
        : unsupported(validation.message, debug, previousContext);
    }
    const analysis = executeAthleteAnalyticsQuery(state, validation.query);
    return reply("answer", analysis.message, {
      ...debug,
      analysisQuery: validation.query,
      analysisCoverage: analysis.coverage,
      groundingFacts: analysis.facts.map(({ id, label, value, dateKey }) => ({ id, label, value, ...(dateKey ? { dateKey } : {}) })),
    }, analysis.context, {
      evidence: analysis.evidence,
      suggestions: analysis.suggestions,
      safetyDecision: analysis.safetyDecision,
    });
  }
  if (candidate.tool === "compare_periods") {
    const comparison = compareFirstAndLastTwoWeeks(state);
    const readinessDelta = comparison.deltas.readiness;
    const message = `The last two weeks improved on the first two: average readiness moved from ${formatNumber(comparison.first.averageReadiness)} to ${formatNumber(comparison.last.averageReadiness)}, training completion moved from ${comparison.first.trainingCompletionPercent}% to ${comparison.last.trainingCompletionPercent}%, and hydration-goal days moved from ${comparison.first.hydrationGoalPercent}% to ${comparison.last.hydrationGoalPercent}%. ${readinessDelta !== null ? `That is a ${signed(readinessDelta)}-point readiness change.` : ""}`.trim();
    return reply("answer", message, debug, {
      topic: "period_comparison",
      rangeStart: comparison.first.startDate,
      rangeEnd: comparison.last.endDate,
    }, {
      evidence: comparison.evidence,
      suggestions: ["Which day had my best readiness?", "What should I improve?"],
    });
  }
  if (candidate.tool === "find_best_day") {
    assertOnlyKeys(candidate.arguments, ["metric"]);
    const metric = candidate.arguments.metric;
    if (!(metric === "readiness" || metric === "trainingCompletion" || PERFORMANCE_KEYS.includes(metric as PerformanceMetric))) {
      return reply(
        "clarification",
        "Which type of best day do you mean: readiness, sprint, strength, or training completion? Different metrics have different directions.",
        debug,
        { topic: "best_day" },
        { options: ["Best readiness", "Best 30 m sprint", "Best vertical jump", "Best training completion"] },
      );
    }
    const result = findBestDay(state, metric as PerformanceMetric | "readiness" | "trainingCompletion");
    if (!result) return unsupported("There is no recorded data for that metric in this 30-day demo.", debug, previousContext);
    const day = result.days[0];
    const metricLabel = metric === "readiness" ? "readiness" : metric === "trainingCompletion" ? "training completion" : PERFORMANCE_METRICS[metric as PerformanceMetric].label;
    const value = metric === "readiness" ? `${result.value}/100` : metric === "trainingCompletion" ? `${result.value}%` : formatMetricValue(metric as PerformanceMetric, result.value);
    const supporting = metric === "readiness" ? wellnessEvidence(day) : [];
    return reply("answer", `Your best ${metricLabel} day was ${formatDate(day.dateKey)}, at ${value}.${result.days.length > 1 ? ` ${result.days.length} days tied at that value.` : ""}`, debug, {
      topic: "best_day",
      metric: metric as AssistantConversationContext["metric"],
      dateKey: day.dateKey,
    }, {
      evidence: [...result.evidence, ...supporting],
      suggestions: ["Why?", "How did I progress this month?"],
    });
  }
  if (candidate.tool === "get_day_details") {
    assertOnlyKeys(candidate.arguments, ["dateKey"]);
    const dateKey = typeof candidate.arguments.dateKey === "string" ? candidate.arguments.dateKey : previousContext.dateKey;
    if (!dateKey) return reply("clarification", "Which recorded date would you like me to explain?", debug, previousContext);
    const day = getDayDetails(state, dateKey);
    if (!day) {
      return reply("answer", `I don’t have recorded data for ${formatDate(dateKey)}. The demo history runs from 13 June to 12 July 2026, so I won’t invent values for that day.`, debug, { topic: "day_details" }, {
        evidence: [{ label: "Available history", value: "13 Jun 2026 – 12 Jul 2026" }],
        safetyDecision: "No data was invented for an unrecorded date.",
      });
    }
    return reply("answer", dayExplanation(day, previousContext.metric), debug, {
      ...previousContext,
      topic: "day_details",
      dateKey,
    }, {
      evidence: [...wellnessEvidence(day), ...dayTrainingEvidence(day)],
      suggestions: ["How did I progress this month?", "What should I improve?"],
    });
  }
  if (candidate.tool === "get_coach_update") {
    return reply("answer", coachUpdateMessage(state), debug, { topic: "coach_message" }, {
      evidence: coachMessageEvidence(state),
      suggestions: ["What has Coach Priya planned for Monday?"],
    });
  }
  if (candidate.tool === "get_coach_workout_plan") {
    assertOnlyKeys(candidate.arguments, ["dateKey"]);
    const dateKey = typeof candidate.arguments.dateKey === "string" ? candidate.arguments.dateKey : "2026-07-13";
    const plan = getPublishedCoachPlan(state, dateKey);
    if (!plan) return reply("answer", `Coach Priya has no published workout for ${formatDate(dateKey)}. Drafts are not visible to athletes.`, debug, { topic: "coach_plan", dateKey }, {
      safetyDecision: "Only published coach plans are athlete-visible.",
    });
    const evidence: AssistantEvidence[] = [
      { label: "Workout", value: `${plan.title} · ${plan.focus}`, dateKey: plan.dateKey },
      { label: "Duration", value: `${plan.durationMinutes} minutes` },
      ...plan.exercises.flatMap((exercise) => exerciseEvidence(exercise, plan.dateKey)),
    ];
    return reply("answer", `${state.coach.name} published ${plan.title} for ${formatPlanDate(plan.dateKey)}. It contains ${plan.exercises.map((exercise) => exercise.name).join(", ")}. The exercise cards show the approved volume, load, target RPE, and rest.`, debug, {
      topic: "coach_plan", dateKey: plan.dateKey, planId: plan.id,
    }, {
      evidence,
      suggestions: ["How many tire flips should I do?", "What intensity is the farmer’s walk?", "And the sled?"],
      safetyDecision: "Displayed Coach Priya’s latest published version only.",
    });
  }
  if (candidate.tool === "explain_exercise_prescription") {
    assertOnlyKeys(candidate.arguments, ["exerciseReference", "planId"]);
    const reference = typeof candidate.arguments.exerciseReference === "string" ? candidate.arguments.exerciseReference : "";
    const requestedPlanId = typeof candidate.arguments.planId === "string" ? candidate.arguments.planId : previousContext.planId;
    if (!reference) return reply("clarification", "Which exercise should I explain—farmer’s walk, tire flip, or sled push?", debug, previousContext);
    const found = findPublishedExercise(state, requestedPlanId, reference);
    if (!found) return unsupported("I couldn’t find that exercise in Coach Priya’s published workout.", debug, previousContext);
    const { plan, exercise } = found;
    const volume = exercise.reps !== undefined ? `${exercise.sets} sets of ${exercise.reps} reps` : `${exercise.sets} sets of ${exercise.distanceMeters} metres`;
    return reply("answer", `${state.coach.name} prescribed ${exercise.name}: ${volume} at ${exercise.loadKg} kg${exercise.loadLabel ? ` ${exercise.loadLabel}` : ""}, target RPE ${exercise.targetRpe}, with ${exercise.restSeconds} seconds rest.`, debug, {
      topic: "exercise", dateKey: plan.dateKey, planId: plan.id, exerciseId: exercise.id,
    }, {
      evidence: exerciseEvidence(exercise, plan.dateKey),
      suggestions: exercise.name.includes("Sled") ? ["Should I increase intensity?"] : ["And the sled?", "Should I increase intensity?"],
      safetyDecision: "Explained the published coach prescription without changing it.",
    });
  }
  if (candidate.tool === "evaluate_intensity_question") {
    assertOnlyKeys(candidate.arguments, ["mode"]);
    const summary = getProgressSummary(state, 30);
    const plan = getLatestPublishedCoachPlan(state);
    if (candidate.arguments.mode === "continue") {
      const completion = summary.stats.trainingCompletionPercent;
      const planNames = plan?.exercises.map((exercise) => exercise.name).join(", ") ?? "no currently published exercises";
      const completedSprint = state.days.flatMap((day) => day.sessions).filter((session) => /sprint|speed/i.test(session.title) && session.status === "completed").length;
      const sprintTotal = state.days.flatMap((day) => day.sessions).filter((session) => /sprint|speed/i.test(session.title)).length;
      const completedStrength = state.days.flatMap((day) => day.sessions).filter((session) => /strength|strongman/i.test(session.title) && session.status === "completed").length;
      const strengthTotal = state.days.flatMap((day) => day.sessions).filter((session) => /strength|strongman/i.test(session.title)).length;
      return reply("answer", `Your 30-day history shows ${completion}% completed sessions, including ${completedSprint}/${sprintTotal} sprint sessions and ${completedStrength}/${strengthTotal} strength or strongman sessions, with improvements across all four recorded benchmarks. Coach Priya’s published continuation plan contains ${planNames}. That is the authoritative plan; I can show how you responded historically, but I won’t independently choose or prescribe workouts.`, debug, {
        topic: "intensity", rangeDays: 30, rangeStart: summary.startDate, rangeEnd: summary.endDate, planId: plan?.id,
      }, {
        evidence: [
          ...summary.evidence.slice(1, 4),
          { label: "Sprint completion", value: `${completedSprint}/${sprintTotal} sessions` },
          { label: "Strength completion", value: `${completedStrength}/${strengthTotal} sessions` },
          ...(plan ? [{ label: "Published plan", value: `${plan.title} v${plan.version}`, dateKey: plan.dateKey }] : []),
        ],
        suggestions: ["What has Coach Priya planned for Monday?", "Message my coach that I want to review which workouts to continue."],
        safetyDecision: "No workout was independently prescribed; only history and the published coach plan were reported.",
      });
    }
    const benchmarkSentence = summary.benchmarks.map((item) => `${PERFORMANCE_METRICS[item.metric].label} ${formatBenchmarkDelta(item)}`).join("; ");
    return reply("answer", `Your recorded benchmarks are improving (${benchmarkSentence}), but that evidence alone does not authorize a load or intensity increase. Follow the published target RPE and loads. Coach Priya must approve any change after reviewing your response and recovery.`, debug, {
      topic: "intensity", rangeDays: 30, rangeStart: summary.startDate, rangeEnd: summary.endDate, planId: plan?.id,
    }, {
      evidence: [
        ...summary.evidence.slice(1),
        ...(plan ? [
          { label: "Current coach prescription", value: `${plan.title} v${plan.version}`, dateKey: plan.dateKey },
          ...plan.exercises.flatMap((exercise) => exerciseEvidence(exercise, plan.dateKey)),
        ] : []),
      ],
      suggestions: ["Message my coach that I would like to review whether my training intensity should change."],
      safetyDecision: "Intensity change withheld; Coach Priya approval is required.",
    });
  }
  return null;
}

type ToolProposal =
  | { clarification: string; options?: string[] }
  | { unsupported: string }
  | { summary: string; displayFields: Array<{ label: string; value: string }>; toolCall: Omit<DemoToolCall, "operationId"> };

function buildToolProposal(state: DemoState, candidate: AssistantCandidate): ToolProposal {
  const args = candidate.arguments;
  const today = getActiveDemoDay(state);
  if (candidate.tool === "add_water") {
    assertOnlyKeys(args, ["amountMl"]);
    if (args.amountMl === undefined) return { clarification: "How much water did you drink? You can answer in millilitres or litres." };
    const amountMl = integer(args.amountMl);
    if (amountMl === null || amountMl < 50 || amountMl > 5000) return { unsupported: "That water amount is outside the supported 50–5,000 ml range." };
    return {
      summary: `Add ${amountMl.toLocaleString("en-IN")} ml of water`,
      displayFields: [
        { label: "Amount", value: `${amountMl.toLocaleString("en-IN")} ml` },
        { label: "New total", value: `${(today.hydration.totalMl + amountMl).toLocaleString("en-IN")} ml` },
      ],
      toolCall: { tool: "add_water", arguments: { amountMl } },
    };
  }
  if (candidate.tool === "record_wellness") {
    assertOnlyKeys(args, [...WELLNESS_KEYS, "wellnessScore", "wellnessField", "wellnessValue"]);
    const requestedField = WELLNESS_KEYS.includes(args.wellnessField as WellnessKey) ? args.wellnessField as WellnessKey : null;
    if (requestedField) return wellnessValueClarification(requestedField);
    const values: Partial<Record<WellnessKey, number>> = {};
    for (const key of WELLNESS_KEYS) {
      if (args[key] === undefined) continue;
      const value = integer(args[key]);
      if (value === null || value < 1 || value > 10) return wellnessValueClarification(key);
      values[key] = value;
    }
    const entries = Object.entries(values) as Array<[WellnessKey, number]>;
    if (!entries.length) {
      const score = integer(args.wellnessScore);
      return {
        clarification: score !== null
          ? `Which wellness field should receive ${score}/10—sleep quality, mood, soreness, or fatigue?`
          : "Which wellness value would you like to record, and what is its 1–10 score?",
        options: score !== null ? WELLNESS_KEYS.map((key) => `${capitalize(wellnessLabel(key))} ${score}`) : ["Sleep quality", "Mood", "Soreness", "Fatigue"],
      };
    }
    return {
      summary: `Update ${joinList(entries.map(([key]) => wellnessLabel(key)))}`,
      displayFields: entries.map(([key, value]) => ({ label: wellnessLabel(key), value: `${value} / 10` })),
      toolCall: { tool: "record_wellness", arguments: values },
    };
  }
  if (candidate.tool === "update_training_session") {
    assertOnlyKeys(args, ["sessionReference", "status", "sets", "reps", "effort", "actualDurationMinutes"]);
    const status = args.status;
    if (status !== "completed" && status !== "partial" && status !== "skipped") return { clarification: "Was the session completed, partially completed, or skipped?" };
    const resolved = resolveSession(today, typeof args.sessionReference === "string" ? args.sessionReference : undefined);
    if (resolved.kind !== "resolved") return resolved;
    const sets = optionalInteger(args.sets, 1, 20, "Sets"); if (typeof sets === "string") return { unsupported: sets };
    const reps = optionalInteger(args.reps, 1, 100, "Repetitions"); if (typeof reps === "string") return { unsupported: reps };
    const effort = optionalInteger(args.effort, 1, 10, "Effort"); if (typeof effort === "string") return { unsupported: effort };
    const actualDurationMinutes = optionalInteger(args.actualDurationMinutes, 1, 240, "Duration"); if (typeof actualDurationMinutes === "string") return { unsupported: actualDurationMinutes };
    const actuals = {
      ...(sets !== undefined ? { sets } : {}), ...(reps !== undefined ? { reps } : {}),
      ...(effort !== undefined ? { effort } : {}), ...(actualDurationMinutes !== undefined ? { actualDurationMinutes } : {}),
    };
    return {
      summary: `${capitalize(resolved.session.slot)} ${resolved.session.title}: ${status}`,
      displayFields: [
        { label: "Session", value: sessionName(resolved.session) }, { label: "Status", value: capitalize(status) },
        ...(sets !== undefined ? [{ label: "Sets", value: String(sets) }] : []),
        ...(reps !== undefined ? [{ label: "Repetitions", value: String(reps) }] : []),
        ...(effort !== undefined ? [{ label: "Effort", value: `${effort} / 10` }] : []),
        ...(actualDurationMinutes !== undefined ? [{ label: "Duration", value: `${actualDurationMinutes} min` }] : []),
      ],
      toolCall: { tool: "update_training_session", arguments: { sessionId: resolved.session.id, status, ...actuals } },
    };
  }
  if (candidate.tool === "record_recovery") {
    assertOnlyKeys(args, ["modalities"]);
    if (!Array.isArray(args.modalities) || !args.modalities.length) return { clarification: "Which recovery activity did you complete—stretching, mobility, ice bath, or physio?" };
    const modalities = [...new Set(args.modalities.map((value) => RECOVERY_MAP[String(value).toLowerCase()]))];
    if (modalities.some((value) => !value)) return { unsupported: "One or more recovery activities are not supported." };
    const safe = modalities as RecoveryModality[];
    return { summary: `Log recovery: ${joinList(safe)}`, displayFields: [{ label: "Recovery", value: joinList(safe) }], toolCall: { tool: "record_recovery", arguments: { modalities: safe } } };
  }
  if (candidate.tool === "send_coach_message") {
    assertOnlyKeys(args, ["body"]);
    const body = typeof args.body === "string" ? args.body.trim() : "";
    if (!body) return { clarification: `What would you like to tell ${state.coach.name}?` };
    if (body.length > 500) return { unsupported: "The coach message must be 500 characters or fewer." };
    return {
      summary: `Send a message to ${state.coach.name}`,
      displayFields: [{ label: "Recipient", value: state.coach.name }, { label: "Message", value: body }],
      toolCall: { tool: "send_coach_message", arguments: { coachId: state.coach.id, body } },
    };
  }
  return { unsupported: "That action is not available in this demo." };
}

function reply(
  kind: "answer" | "clarification",
  message: string,
  debug: AssistantInterpretation["debug"],
  context: AssistantConversationContext,
  extras: { evidence?: AssistantEvidence[]; suggestions?: string[]; options?: string[]; safetyDecision?: string } = {},
): ResolvedAssistantTurn {
  const enhancedDebug = {
    ...debug,
    context,
    dateRange: context.rangeStart && context.rangeEnd ? { start: context.rangeStart, end: context.rangeEnd } : undefined,
    metric: context.metric,
    evidence: extras.evidence,
    safetyDecision: extras.safetyDecision ?? "Read-only response calculated from stored demo data.",
  };
  return kind === "answer"
    ? { response: { kind, message, evidence: extras.evidence, suggestions: extras.suggestions, context, debug: enhancedDebug } }
    : { response: { kind, message, evidence: extras.evidence, suggestions: extras.suggestions, options: extras.options, context, debug: enhancedDebug } };
}

function unsupported(message: string, debug: AssistantInterpretation["debug"], context: AssistantConversationContext): ResolvedAssistantTurn {
  return { response: { kind: "unsupported", message, context, debug: { ...debug, context, safetyDecision: "No action executed." } } };
}

function resolveSession(day: DemoDay, reference?: string):
  | { kind: "resolved"; session: DemoSession }
  | { kind: "clarification"; clarification: string; options: string[] }
  | { kind: "unsupported"; unsupported: string } {
  if (reference) {
    const needle = reference.toLowerCase();
    const matches = day.sessions.filter((session) => needle.includes(session.slot) || needle.includes(session.title.toLowerCase()) || session.title.toLowerCase().includes(needle));
    if (matches.length === 1) return { kind: "resolved", session: matches[0] };
    if (matches.length > 1) return { kind: "clarification", clarification: "Which matching session did you mean?", options: matches.map(sessionName) };
    return { kind: "unsupported", unsupported: `I couldn’t match “${reference}” to one of today’s sessions.` };
  }
  const incomplete = day.sessions.filter((session) => session.status === "planned");
  if (incomplete.length === 1) return { kind: "resolved", session: incomplete[0] };
  if (incomplete.length > 1) return { kind: "clarification", clarification: "You have two incomplete sessions. Which one did you mean?", options: incomplete.map(sessionName) };
  return { kind: "unsupported", unsupported: "There are no incomplete sessions to update today." };
}

function dailyStatusMessage(day: DemoDay) {
  const missing = WELLNESS_KEYS.filter((key) => day.wellness[key] === null).map(wellnessLabel);
  const pending = day.sessions.filter((session) => session.status === "planned").map(sessionName);
  return [
    `You have logged ${day.hydration.totalMl.toLocaleString("en-IN")} ml of water out of ${day.hydration.goalMl.toLocaleString("en-IN")} ml.`,
    missing.length ? `Wellness still needs ${joinList(missing)}.` : "Your wellness check-in is complete.",
    pending.length ? `Training still pending: ${joinList(pending)}.` : "Both training sessions have an outcome.",
    day.recovery.modalities.length ? `Recovery logged: ${joinList(day.recovery.modalities)}.` : "Recovery has not been logged.",
  ].join(" ");
}

function dailyStatusEvidence(day: DemoDay): AssistantEvidence[] {
  return [
    { label: "Hydration", value: `${day.hydration.totalMl.toLocaleString("en-IN")} / ${day.hydration.goalMl.toLocaleString("en-IN")} ml`, dateKey: day.dateKey },
    { label: "Wellness fields complete", value: `${WELLNESS_KEYS.filter((key) => day.wellness[key] !== null).length} / 4` },
    { label: "Training outcomes", value: `${day.sessions.filter((session) => session.status !== "planned").length} / ${day.sessions.length}` },
  ];
}

function progressSummaryMessage(summary: ReturnType<typeof getProgressSummary>) {
  const benchmarkText = summary.benchmarks.map((delta) => `${PERFORMANCE_METRICS[delta.metric].label} ${formatBenchmarkDelta(delta)}`).join("; ");
  return `From ${formatDate(summary.startDate)} to ${formatDate(summary.endDate)}, average readiness was ${formatNumber(summary.stats.averageReadiness)}/100, training completion was ${summary.stats.trainingCompletionPercent}%, and the hydration goal was reached on ${summary.stats.hydrationGoalPercent}% of days. Recorded performance improved across the available benchmarks: ${benchmarkText}.`;
}

function progressPrioritiesMessage(summary: ReturnType<typeof getProgressSummary>) {
  return `I checked the configured thresholds for ${formatDate(summary.startDate)} to ${formatDate(summary.endDate)}. ${summary.priorities.join(" ")} These are reporting priorities, not a prescription to change training intensity.`;
}

function dayExplanation(day: DemoDay, metric?: AssistantConversationContext["metric"]) {
  const contextLead = metric === "readiness" && day.readiness !== null
    ? `${formatDate(day.dateKey)} reached readiness ${day.readiness}/100 because sleep quality was ${day.wellness.sleepQuality}/10, mood ${day.wellness.mood}/10, soreness ${day.wellness.soreness}/10, and fatigue ${day.wellness.fatigue}/10.`
    : `On ${formatDate(day.dateKey)}, readiness was ${day.readiness === null ? "not available" : `${day.readiness}/100`}.`;
  const training = day.sessions.map((session) => `${session.title} was ${session.status}${session.sessionLoad !== undefined ? ` (${session.sessionLoad} AU)` : ""}`).join("; ");
  return `${contextLead} ${training}.${day.note ? ` Context: ${day.note}` : ""}`;
}

function wellnessEvidence(day: DemoDay): AssistantEvidence[] {
  return [
    { label: "Readiness", value: day.readiness === null ? "Not available" : `${day.readiness}/100`, dateKey: day.dateKey },
    { label: "Sleep", value: `${day.wellness.sleepHours ?? "—"} h · quality ${day.wellness.sleepQuality ?? "—"}/10` },
    { label: "Mood", value: `${day.wellness.mood ?? "—"}/10` },
    { label: "Soreness", value: `${day.wellness.soreness ?? "—"}/10` },
    { label: "Fatigue", value: `${day.wellness.fatigue ?? "—"}/10` },
  ];
}

function dayTrainingEvidence(day: DemoDay): AssistantEvidence[] {
  return day.sessions.map((session) => ({
    label: session.title,
    value: `${capitalize(session.status)}${session.actualDurationMinutes ? ` · ${session.actualDurationMinutes} min` : ""}${session.effortRating ? ` · RPE ${session.effortRating}` : ""}${session.sessionLoad ? ` · ${session.sessionLoad} AU` : ""}`,
    dateKey: day.dateKey,
  }));
}

function coachUpdateMessage(state: DemoState) {
  const messages = state.coach.messages.filter((message) => message.sender === "coach");
  const latest = messages.at(-1);
  if (!latest) return `${state.coach.name} hasn’t sent you a message yet.`;
  return `Yes—you have ${messages.length} message${messages.length === 1 ? "" : "s"} from ${state.coach.name}. The latest says: “${latest.body}”`;
}

function coachMessageEvidence(state: DemoState): AssistantEvidence[] {
  const latest = state.coach.messages.filter((message) => message.sender === "coach").at(-1);
  return latest ? [{ label: `Latest from ${state.coach.name}`, value: latest.body, dateKey: latest.createdAt.slice(0, 10) }] : [];
}

function wellnessValueClarification(key: WellnessKey): ToolProposal {
  const hint = key === "sleepQuality" ? "1 means very poor sleep and 10 means excellent sleep." : key === "mood" ? "1 means very low mood and 10 means very positive mood." : `1 means very low ${wellnessLabel(key)} and 10 means very high ${wellnessLabel(key)}.`;
  return { clarification: `I can record ${wellnessLabel(key)} only as a whole number from 1 to 10. ${hint} What number should I save?`, options: [1, 3, 5, 7, 10].map((value) => `${capitalize(wellnessLabel(key))} ${value}`) };
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("unknown_candidate_field");
}

function integer(value: unknown) { return typeof value === "number" && Number.isInteger(value) ? value : null; }
function optionalInteger(value: unknown, min: number, max: number, label: string): number | undefined | string {
  if (value === undefined) return undefined;
  const parsed = integer(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : `${label} must be a whole number from ${min} to ${max}.`;
}
function candidateLabel(tool: AssistantCandidate["tool"]) {
  return ({
    get_daily_status: "checking daily status", get_progress_summary: "reviewing progress", analyze_athlete_data: "analyzing recorded athlete data", compare_periods: "comparing periods",
    find_best_day: "finding a best day", get_day_details: "reviewing a day", get_coach_update: "checking coach messages",
    get_coach_workout_plan: "reviewing the coach plan", explain_exercise_prescription: "explaining an exercise",
    evaluate_intensity_question: "reviewing intensity evidence", add_water: "adding water", record_wellness: "updating wellness",
    update_training_session: "updating training", record_recovery: "logging recovery", send_coach_message: "messaging your coach",
    unsupported: "an unsupported request",
  })[tool];
}
function wellnessLabel(key: WellnessKey) { return ({ sleepQuality: "sleep quality", mood: "mood", soreness: "soreness", fatigue: "fatigue" })[key]; }
function sessionName(session: DemoSession) { return `${capitalize(session.slot)} ${session.title}`; }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function joinList(values: string[]) { if (values.length < 2) return values[0] ?? ""; if (values.length === 2) return `${values[0]} and ${values[1]}`; return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`; }
function formatNumber(value: number | null) { return value === null ? "not recorded" : value.toFixed(1); }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`; }

function explicitSessionReference(query: string): string | null {
  const references = [
    ...(/\b(?:evening|tonight|pm)\b/i.test(query) ? ["evening"] : []),
    ...(/\b(?:morning|am)\b/i.test(query) ? ["morning"] : []),
    ...(/\bstrength\b/i.test(query) ? ["strength"] : []),
    ...(/\bconditioning\b/i.test(query) ? ["conditioning"] : []),
  ];
  if (!references.length) return null;
  const slots = references.filter((value) => value === "morning" || value === "evening");
  if (new Set(slots).size > 1) return null;
  return references.join(" ");
}
