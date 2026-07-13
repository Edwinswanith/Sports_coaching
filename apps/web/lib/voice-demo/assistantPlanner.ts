import { randomUUID } from "node:crypto";
import type { AssistantCandidate, AssistantInterpretation } from "./assistantInterpreter";
import type {
  AssistantTurnResponse,
  DemoAssistantPlan,
  DemoSession,
  DemoState,
  DemoToolCall,
  RecoveryModality,
  WellnessKey,
} from "./types";

export type ResolvedAssistantTurn = { response: AssistantTurnResponse; plan?: DemoAssistantPlan };

const WELLNESS_KEYS: WellnessKey[] = ["sleepQuality", "mood", "soreness", "fatigue"];
const RECOVERY_MAP: Record<string, RecoveryModality> = {
  stretching: "Stretching",
  mobility: "Mobility",
  "ice bath": "Ice bath",
  ice_bath: "Ice bath",
  physio: "Physio",
};

export function resolveAssistantCandidates(
  state: DemoState,
  interpretation: AssistantInterpretation,
  now = new Date(),
): ResolvedAssistantTurn {
  const { candidates, debug } = interpretation;
  if (candidates.length > 1) {
    const options = candidates.map((candidate) => candidateLabel(candidate.tool));
    return {
      response: {
        kind: "clarification",
        message: `I heard ${options.length} actions: ${joinList(options)}. Please handle one at a time in this phase.`,
        options,
        debug,
      },
    };
  }

  const candidate = candidates[0];
  if (!candidate) return unsupported("I couldn’t identify an athlete action in that request.", debug);
  if (candidate.tool === "get_daily_status") {
    return { response: { kind: "answer", message: dailyStatusMessage(state), debug } };
  }
  if (candidate.tool === "get_progress_guidance") {
    return { response: { kind: "answer", message: progressGuidanceMessage(state), debug } };
  }
  if (candidate.tool === "get_coach_update") {
    return { response: { kind: "answer", message: coachUpdateMessage(state), debug } };
  }
  if (candidate.tool === "unsupported") {
    return unsupported("I can help with status, water, wellness, training, recovery, or a coach message.", debug);
  }

  try {
    const proposal = buildToolProposal(state, candidate);
    if ("clarification" in proposal) {
      return { response: { kind: "clarification", message: proposal.clarification, options: proposal.options, debug } };
    }
    if ("unsupported" in proposal) return unsupported(proposal.unsupported, debug);

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
        plan: {
          id: plan.id,
          tool: plan.toolCall.tool,
          summary: plan.summary,
          displayFields: plan.displayFields,
          expiresAt: plan.expiresAt,
        },
        debug,
      },
    };
  } catch {
    return unsupported("I couldn’t safely validate that request. Try a more specific command or use manual entry.", debug);
  }
}

type ToolProposal =
  | { clarification: string; options?: string[] }
  | { unsupported: string }
  | {
      summary: string;
      displayFields: Array<{ label: string; value: string }>;
      toolCall: Omit<DemoToolCall, "operationId">;
    };

function buildToolProposal(state: DemoState, candidate: AssistantCandidate): ToolProposal {
  const args = candidate.arguments;

  if (candidate.tool === "add_water") {
    assertOnlyKeys(args, ["amountMl"]);
    if (args.amountMl === undefined) return { clarification: "How much water did you drink? You can answer in millilitres or litres." };
    const amountMl = integer(args.amountMl);
    if (amountMl === null || amountMl < 50 || amountMl > 5000) {
      return { unsupported: "That water amount is outside the supported 50–5,000 ml range." };
    }
    return {
      summary: `Add ${amountMl.toLocaleString("en-IN")} ml of water`,
      displayFields: [
        { label: "Amount", value: `${amountMl.toLocaleString("en-IN")} ml` },
        { label: "New total", value: `${(state.hydration.totalMl + amountMl).toLocaleString("en-IN")} ml` },
      ],
      toolCall: { tool: "add_water", arguments: { amountMl } },
    };
  }

  if (candidate.tool === "record_wellness") {
    assertOnlyKeys(args, [...WELLNESS_KEYS, "wellnessScore", "wellnessField", "wellnessValue"]);
    const requestedField = WELLNESS_KEYS.includes(args.wellnessField as WellnessKey)
      ? (args.wellnessField as WellnessKey)
      : null;
    if (requestedField) return wellnessValueClarification(requestedField);

    const values: Partial<Record<WellnessKey, number>> = {};
    for (const key of WELLNESS_KEYS) {
      if (args[key] === undefined) continue;
      const value = integer(args[key]);
      if (value === null || value < 1 || value > 10) {
        return wellnessValueClarification(key);
      }
      values[key] = value;
    }
    const entries = Object.entries(values) as Array<[WellnessKey, number]>;
    if (!entries.length) {
      const genericScore = integer(args.wellnessScore);
      return {
        clarification: genericScore !== null
          ? `Which wellness field should receive ${genericScore}/10—sleep quality, mood, soreness, or fatigue?`
          : "Which wellness value would you like to record, and what is its 1–10 score?",
        options: genericScore !== null
          ? WELLNESS_KEYS.map((key) => `${capitalize(wellnessLabel(key))} ${genericScore}`)
          : ["Sleep quality", "Mood", "Soreness", "Fatigue"],
      };
    }
    return {
      summary: `Update ${joinList(entries.map(([key]) => wellnessLabel(key)))}`,
      displayFields: entries.map(([key, value]) => ({ label: wellnessLabel(key), value: `${value} / 10` })),
      toolCall: { tool: "record_wellness", arguments: values },
    };
  }

  if (candidate.tool === "update_training_session") {
    assertOnlyKeys(args, ["sessionReference", "status", "sets", "reps", "effort"]);
    const status = args.status;
    if (status !== "completed" && status !== "partial" && status !== "skipped") {
      return { clarification: "Was the session completed, partially completed, or skipped?" };
    }
    const resolved = resolveSession(state, typeof args.sessionReference === "string" ? args.sessionReference : undefined);
    if (resolved.kind === "clarification") return resolved;
    if (resolved.kind === "unsupported") return resolved;

    const sets = optionalInteger(args.sets, 1, 30, "Sets");
    if (typeof sets === "string") return { unsupported: sets };
    const reps = optionalInteger(args.reps, 1, 200, "Repetitions");
    if (typeof reps === "string") return { unsupported: reps };
    const effort = optionalInteger(args.effort, 1, 10, "Effort");
    if (typeof effort === "string") return { unsupported: effort };

    const actuals = {
      ...(sets !== undefined ? { sets } : {}),
      ...(reps !== undefined ? { reps } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
    const fields = [
      { label: "Session", value: `${capitalize(resolved.session.slot)} ${resolved.session.title}` },
      { label: "Status", value: capitalize(status) },
      ...(sets !== undefined ? [{ label: "Sets", value: String(sets) }] : []),
      ...(reps !== undefined ? [{ label: "Repetitions", value: String(reps) }] : []),
      ...(effort !== undefined ? [{ label: "Effort", value: `${effort} / 10` }] : []),
    ];
    return {
      summary: `${capitalize(resolved.session.slot)} ${resolved.session.title}: ${status}`,
      displayFields: fields,
      toolCall: {
        tool: "update_training_session",
        arguments: { sessionId: resolved.session.id, status, ...actuals },
      },
    };
  }

  if (candidate.tool === "record_recovery") {
    assertOnlyKeys(args, ["modalities"]);
    if (!Array.isArray(args.modalities) || !args.modalities.length) {
      return { clarification: "Which recovery activity did you complete—stretching, mobility, ice bath, or physio?" };
    }
    const modalities = [...new Set(args.modalities.map((value) => RECOVERY_MAP[String(value).toLowerCase()]))];
    if (modalities.some((value) => !value)) return { unsupported: "One or more recovery activities are not supported." };
    const safeModalities = modalities as RecoveryModality[];
    return {
      summary: `Log recovery: ${joinList(safeModalities)}`,
      displayFields: [{ label: "Recovery", value: joinList(safeModalities) }],
      toolCall: { tool: "record_recovery", arguments: { modalities: safeModalities } },
    };
  }

  if (candidate.tool === "send_coach_message") {
    assertOnlyKeys(args, ["body"]);
    const body = typeof args.body === "string" ? args.body.trim() : "";
    if (!body) return { clarification: `What would you like to tell ${state.coach.name}?` };
    if (body.length > 500) return { unsupported: "The coach message must be 500 characters or fewer." };
    return {
      summary: `Send a message to ${state.coach.name}`,
      displayFields: [
        { label: "Recipient", value: state.coach.name },
        { label: "Message", value: body },
      ],
      toolCall: { tool: "send_coach_message", arguments: { coachId: state.coach.id, body } },
    };
  }

  return { unsupported: "That action is not available in this demo." };
}

function resolveSession(
  state: DemoState,
  reference?: string,
): { kind: "resolved"; session: DemoSession } | { kind: "clarification"; clarification: string; options: string[] } | { kind: "unsupported"; unsupported: string } {
  if (reference) {
    const needle = reference.toLowerCase();
    const matches = state.sessions.filter(
      (session) => needle.includes(session.slot) || needle.includes(session.title.toLowerCase()) || session.title.toLowerCase().includes(needle),
    );
    if (matches.length === 1) return { kind: "resolved", session: matches[0] };
    if (matches.length > 1) {
      return { kind: "clarification", clarification: "Which matching session did you mean?", options: matches.map(sessionName) };
    }
    return { kind: "unsupported", unsupported: `I couldn’t match “${reference}” to one of today’s sessions.` };
  }

  const incomplete = state.sessions.filter((session) => session.status === "planned");
  if (incomplete.length === 1) return { kind: "resolved", session: incomplete[0] };
  if (incomplete.length > 1) {
    return {
      kind: "clarification",
      clarification: "You have two incomplete sessions. Which one did you mean?",
      options: incomplete.map(sessionName),
    };
  }
  return { kind: "unsupported", unsupported: "There are no incomplete sessions to update today." };
}

function dailyStatusMessage(state: DemoState) {
  const missingWellness = WELLNESS_KEYS.filter((key) => state.wellness[key] === null).map(wellnessLabel);
  const pendingSessions = state.sessions.filter((session) => session.status === "planned").map(sessionName);
  const parts = [
    `You have logged ${state.hydration.totalMl.toLocaleString("en-IN")} ml of water out of ${state.hydration.goalMl.toLocaleString("en-IN")} ml.`,
    missingWellness.length ? `Wellness still needs ${joinList(missingWellness)}.` : "Your wellness check-in is complete.",
    pendingSessions.length ? `Training still pending: ${joinList(pendingSessions)}.` : "Both training sessions have an outcome.",
    state.recovery.modalities.length ? `Recovery logged: ${joinList(state.recovery.modalities)}.` : "Recovery has not been logged.",
  ];
  return parts.join(" ");
}

function progressGuidanceMessage(state: DemoState) {
  const recordedWellness = WELLNESS_KEYS.filter((key) => state.wellness[key] !== null);
  const missingWellness = WELLNESS_KEYS.filter((key) => state.wellness[key] === null).map(wellnessLabel);
  const reportedSessions = state.sessions.filter((session) => session.status !== "planned");
  const pendingSessions = state.sessions.filter((session) => session.status === "planned").map(sessionName);
  const hydrationPercent = Math.min(100, Math.round((state.hydration.totalMl / state.hydration.goalMl) * 100));
  const hydrationRemaining = Math.max(0, state.hydration.goalMl - state.hydration.totalMl);
  const priorities = [
    ...(missingWellness.length ? [`record ${joinList(missingWellness)}`] : []),
    ...(pendingSessions.length ? [`report an outcome for ${joinList(pendingSessions)}`] : []),
    ...(!state.recovery.modalities.length ? ["log any recovery work you complete"] : []),
    ...(hydrationRemaining ? [`continue toward your hydration target (${hydrationRemaining.toLocaleString("en-IN")} ml remaining)`] : []),
  ];

  const snapshot = `Based on today’s updates, you have recorded ${recordedWellness.length} of ${WELLNESS_KEYS.length} wellness values, reported ${reportedSessions.length} of ${state.sessions.length} sessions, and logged ${state.hydration.totalMl.toLocaleString("en-IN")} ml of ${state.hydration.goalMl.toLocaleString("en-IN")} ml hydration (${hydrationPercent}%).`;
  const trendBoundary = "This demo only contains today’s data, so I can’t reliably judge a long-term performance trend yet.";
  const nextStep = priorities.length
    ? `Your next priorities are to ${joinList(priorities)}.`
    : "Today’s reporting is complete, so keep following your coach’s plan and record any changes as they happen.";
  const coachFocus = state.coach.latestGuidance
    ? `Coach ${state.coach.name.replace(/^Coach\s+/i, "")}’s current focus: ${state.coach.latestGuidance}`
    : "";
  return [snapshot, trendBoundary, nextStep, coachFocus].filter(Boolean).join(" ");
}

function coachUpdateMessage(state: DemoState) {
  const coachMessages = state.coach.messages.filter((message) => message.sender === "coach");
  const latestMessage = coachMessages.at(-1);
  if (!latestMessage) return `${state.coach.name} hasn’t sent you a message yet.`;

  const count = coachMessages.length;
  const introduction = count === 1
    ? `Yes—${state.coach.name} sent you a message.`
    : `Yes—you have ${count} messages from ${state.coach.name}.`;
  return `${introduction} The latest says: “${latestMessage.body}”`;
}

function wellnessValueClarification(key: WellnessKey): ToolProposal {
  const scaleHint = key === "sleepQuality"
    ? "1 means very poor sleep and 10 means excellent sleep."
    : key === "mood"
      ? "1 means very low mood and 10 means very positive mood."
      : `1 means very low ${wellnessLabel(key)} and 10 means very high ${wellnessLabel(key)}.`;
  return {
    clarification: `I can record ${wellnessLabel(key)} only as a whole number from 1 to 10. ${scaleHint} What number should I save?`,
    options: [1, 3, 5, 7, 10].map((value) => `${capitalize(wellnessLabel(key))} ${value}`),
  };
}

function unsupported(message: string, debug: AssistantInterpretation["debug"]): ResolvedAssistantTurn {
  return { response: { kind: "unsupported", message, debug } };
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("unknown_candidate_field");
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function optionalInteger(value: unknown, min: number, max: number, label: string): number | undefined | string {
  if (value === undefined) return undefined;
  const parsed = integer(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : `${label} must be a whole number from ${min} to ${max}.`;
}

function candidateLabel(tool: AssistantCandidate["tool"]) {
  return ({
    get_daily_status: "checking daily status",
    get_progress_guidance: "reviewing progress",
    get_coach_update: "checking coach messages",
    add_water: "adding water",
    record_wellness: "updating wellness",
    update_training_session: "updating training",
    record_recovery: "logging recovery",
    send_coach_message: "messaging your coach",
    unsupported: "an unsupported request",
  })[tool];
}

function wellnessLabel(key: WellnessKey) {
  return ({ sleepQuality: "sleep quality", mood: "mood", soreness: "soreness", fatigue: "fatigue" })[key];
}

function sessionName(session: DemoSession) {
  return `${capitalize(session.slot)} ${session.title}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function joinList(values: string[]) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
