import type {
  DemoActivity,
  DemoState,
  DemoToolCall,
  DemoToolResult,
  RecoveryModality,
  WellnessKey,
} from "./types";

export class DemoToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoToolError";
  }
}

const WELLNESS_KEYS: WellnessKey[] = ["sleepQuality", "mood", "soreness", "fatigue"];
const RECOVERY_MODALITIES: RecoveryModality[] = ["Stretching", "Mobility", "Ice bath", "Physio"];

export function executeDemoTool(current: DemoState, call: DemoToolCall): { state: DemoState; result: DemoToolResult } {
  validateOperationId(call.operationId);

  const existing = current.operations.find((operation) => operation.id === call.operationId);
  if (existing) {
    return {
      state: cloneState(current),
      result: { ...existing.result, changed: false },
    };
  }

  const state = cloneState(current);
  const now = new Date().toISOString();
  let message = "";

  if (call.tool === "add_water") {
    const amountMl = requireInteger(call.arguments.amountMl, "invalid_water_amount", 50, 5000);
    state.hydration.entries.push({
      id: `water_${call.operationId}`,
      amountMl,
      operationId: call.operationId,
      createdAt: now,
    });
    state.hydration.totalMl += amountMl;
    message = `Added ${amountMl.toLocaleString("en-IN")} ml. Today’s total is ${state.hydration.totalMl.toLocaleString("en-IN")} ml.`;
    addActivity(state, call.operationId, "Water logged", `${amountMl.toLocaleString("en-IN")} ml added`, now);
  } else if (call.tool === "record_wellness") {
    const entries = Object.entries(call.arguments).filter((entry): entry is [WellnessKey, number] =>
      WELLNESS_KEYS.includes(entry[0] as WellnessKey),
    );
    if (entries.length === 0) throw new DemoToolError("missing_wellness_values", "Add at least one wellness value.");
    for (const [key, rawValue] of entries) {
      state.wellness[key] = requireInteger(rawValue, "invalid_wellness_value", 1, 10);
    }
    const labels = entries.map(([key]) => wellnessLabel(key));
    message = `${joinList(labels)} updated. Unmentioned wellness values were left unchanged.`;
    addActivity(state, call.operationId, "Wellness updated", joinList(labels), now);
  } else if (call.tool === "update_training_session") {
    const session = state.sessions.find((candidate) => candidate.id === call.arguments.sessionId);
    if (!session) throw new DemoToolError("session_not_found", "That training session does not exist in this demo.");
    if (!(["completed", "partial", "skipped"] as const).includes(call.arguments.status)) {
      throw new DemoToolError("invalid_session_status", "Choose completed, partial, or skipped.");
    }
    session.status = call.arguments.status;
    if (call.arguments.sets !== undefined) session.sets = requireInteger(call.arguments.sets, "invalid_sets", 1, 30);
    if (call.arguments.reps !== undefined) session.reps = requireInteger(call.arguments.reps, "invalid_reps", 1, 200);
    if (call.arguments.effort !== undefined) session.effort = requireInteger(call.arguments.effort, "invalid_effort", 1, 10);
    message = `${session.title} marked ${session.status}. Only the supplied actual values were updated.`;
    addActivity(state, call.operationId, `${session.title} updated`, capitalize(session.status), now);
  } else if (call.tool === "record_recovery") {
    if (!Array.isArray(call.arguments.modalities) || call.arguments.modalities.length === 0) {
      throw new DemoToolError("missing_recovery", "Choose at least one recovery activity.");
    }
    const unique = [...new Set(call.arguments.modalities)];
    if (unique.some((modality) => !RECOVERY_MODALITIES.includes(modality))) {
      throw new DemoToolError("invalid_recovery", "One or more recovery activities are not supported.");
    }
    state.recovery.modalities = unique;
    message = `${joinList(unique)} saved as today’s recovery.`;
    addActivity(state, call.operationId, "Recovery logged", joinList(unique), now);
  } else if (call.tool === "send_coach_message") {
    if (call.arguments.coachId !== state.coach.id) {
      throw new DemoToolError("coach_not_assigned", "That coach is not assigned to this demo athlete.");
    }
    const body = String(call.arguments.body ?? "").trim();
    if (body.length < 1 || body.length > 500) {
      throw new DemoToolError("invalid_message", "The coach message must be between 1 and 500 characters.");
    }
    state.coach.messages.push({
      id: `message_${call.operationId}`,
      sender: "athlete",
      body,
      operationId: call.operationId,
      createdAt: now,
    });
    message = `Message sent to ${state.coach.name}.`;
    addActivity(state, call.operationId, `Message sent to ${state.coach.name}`, body, now);
  } else {
    const neverCall: never = call;
    throw new DemoToolError("unsupported_tool", `Unsupported demo tool: ${JSON.stringify(neverCall)}`);
  }

  state.version += 1;
  state.updatedAt = now;
  const result: DemoToolResult = { operationId: call.operationId, tool: call.tool, message, changed: true };
  state.operations.push({ id: call.operationId, tool: call.tool, result, createdAt: now });
  return { state, result };
}

function validateOperationId(value: string) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    throw new DemoToolError("invalid_operation_id", "A valid operation ID is required.");
  }
}

function requireInteger(value: number, code: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DemoToolError(code, `Enter a whole number from ${min} to ${max}.`);
  }
  return value;
}

function addActivity(state: DemoState, operationId: string, label: string, detail: string, createdAt: string) {
  const activity: DemoActivity = { id: `activity_${operationId}`, label, detail, createdAt };
  state.activity.unshift(activity);
}

function wellnessLabel(key: WellnessKey) {
  return ({ sleepQuality: "Sleep quality", mood: "Mood", soreness: "Soreness", fatigue: "Fatigue" })[key];
}

function joinList(values: string[]) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cloneState(state: DemoState): DemoState {
  return JSON.parse(JSON.stringify(state)) as DemoState;
}
