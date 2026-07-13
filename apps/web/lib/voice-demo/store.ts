import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createSeedDemoState } from "./seed";
import {
  createCoachPlanDraft,
  editCoachPlanDraft,
  publishCoachPlanDraft,
  type CoachPlanDraftInput,
  type CoachPlanDraftPatch,
} from "./coachPlans";
import type { AssistantInterpretation } from "./assistantInterpreter";
import { resolveAssistantCandidates } from "./assistantPlanner";
import { executeDemoTool } from "./tools";
import { DEMO_SCHEMA_VERSION, type AssistantConversationContext, type AssistantTurnResponse, type DemoCoachWorkoutPlan, type DemoState, type DemoToolCall, type DemoToolResult } from "./types";

const DATA_DIR = path.join(process.cwd(), ".voice-demo-data");
const DATA_FILE = path.join(DATA_DIR, "state.json");

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readDemoState(): Promise<DemoState> {
  try {
    const stored = JSON.parse(await readFile(DATA_FILE, "utf8")) as DemoState;
    if (stored.schemaVersion !== DEMO_SCHEMA_VERSION || !Array.isArray(stored.days) || stored.days.length !== 30) {
      const seed = createSeedDemoState();
      await persist(seed);
      return seed;
    }
    if (!Array.isArray(stored.assistantPlans)) stored.assistantPlans = [];
    if (!Array.isArray(stored.coachPlans)) stored.coachPlans = [];
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seed = createSeedDemoState();
    await persist(seed);
    return seed;
  }
}

export function runStoredDemoTool(call: DemoToolCall): Promise<{ state: DemoState; result: DemoToolResult }> {
  return enqueue(async () => {
    const current = await readDemoState();
    const outcome = executeDemoTool(current, call);
    if (outcome.result.changed) await persist(outcome.state);
    return outcome;
  });
}

export function resetStoredDemoState(): Promise<DemoState> {
  return enqueue(async () => {
    const seed = createSeedDemoState();
    await persist(seed);
    return seed;
  });
}

export function resolveAndStoreAssistantTurn(
  interpretation: AssistantInterpretation,
  context: AssistantConversationContext = {},
): Promise<AssistantTurnResponse> {
  return enqueue(async () => {
    const current = await readDemoState();
    const resolved = resolveAssistantCandidates(current, interpretation, context);
    if (resolved.plan) {
      current.assistantPlans.push(resolved.plan);
      current.updatedAt = new Date().toISOString();
      await persist(current);
    }
    return resolved.response;
  });
}

export function confirmStoredAssistantPlan(planId: string): Promise<AssistantTurnResponse> {
  return enqueue(async () => {
    const current = await readDemoState();
    const plan = current.assistantPlans.find((candidate) => candidate.id === planId);
    if (!plan) throw new DemoAssistantStoreError("plan_not_found", "That assistant plan no longer exists.");
    if (plan.status === "cancelled") throw new DemoAssistantStoreError("plan_cancelled", "That assistant plan was cancelled.");
    if (plan.status === "completed" && plan.result) {
      return { kind: "completed", message: plan.result.message, planId: plan.id, result: plan.result, state: current, context: {} };
    }
    if (new Date(plan.expiresAt).getTime() <= Date.now()) {
      throw new DemoAssistantStoreError("plan_expired", "That assistant plan expired. Submit the command again.");
    }

    const outcome = executeDemoTool(current, plan.toolCall);
    const completedPlan = outcome.state.assistantPlans.find((candidate) => candidate.id === planId);
    if (!completedPlan) throw new DemoAssistantStoreError("plan_not_found", "That assistant plan no longer exists.");
    completedPlan.status = "completed";
    completedPlan.result = outcome.result;
    completedPlan.completedAt = new Date().toISOString();
    await persist(outcome.state);
    return {
      kind: "completed",
      message: outcome.result.message,
      planId: plan.id,
      result: outcome.result,
      state: outcome.state,
      context: {},
    };
  });
}

export function cancelStoredAssistantPlan(planId: string): Promise<AssistantTurnResponse> {
  return enqueue(async () => {
    const current = await readDemoState();
    const plan = current.assistantPlans.find((candidate) => candidate.id === planId);
    if (!plan) throw new DemoAssistantStoreError("plan_not_found", "That assistant plan no longer exists.");
    if (plan.status === "completed") throw new DemoAssistantStoreError("plan_completed", "That assistant plan was already completed.");
    if (plan.status !== "cancelled") {
      plan.status = "cancelled";
      plan.cancelledAt = new Date().toISOString();
      await persist(current);
    }
    return { kind: "cancelled", message: "Cancelled. Nothing was changed.", planId, context: {} };
  });
}

export function listStoredCoachPlans(): Promise<{ state: DemoState; plans: DemoCoachWorkoutPlan[] }> {
  return enqueue(async () => {
    const state = await readDemoState();
    return { state, plans: state.coachPlans };
  });
}

export function createStoredCoachPlanDraft(input: CoachPlanDraftInput) {
  return enqueue(async () => {
    const outcome = createCoachPlanDraft(await readDemoState(), input);
    await persist(outcome.state);
    return outcome;
  });
}

export function editStoredCoachPlanDraft(planId: string, patch: CoachPlanDraftPatch) {
  return enqueue(async () => {
    const outcome = editCoachPlanDraft(await readDemoState(), planId, patch);
    await persist(outcome.state);
    return outcome;
  });
}

export function publishStoredCoachPlanDraft(planId: string) {
  return enqueue(async () => {
    const outcome = publishCoachPlanDraft(await readDemoState(), planId);
    await persist(outcome.state);
    return outcome;
  });
}

export class DemoAssistantStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DemoAssistantStoreError";
  }
}

async function persist(state: DemoState) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, DATA_FILE);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
