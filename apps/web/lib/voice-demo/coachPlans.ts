import { randomUUID } from "node:crypto";
import type { DemoCoachExercise, DemoCoachWorkoutPlan, DemoState } from "./types";

export type CoachPlanDraftInput = {
  basedOnPlanId?: string;
  dateKey?: string;
  slot?: DemoCoachWorkoutPlan["slot"];
  title?: string;
  focus?: string;
  durationMinutes?: number;
  exercises?: DemoCoachExercise[];
};

export type CoachPlanDraftPatch = Partial<Pick<
  DemoCoachWorkoutPlan,
  "dateKey" | "slot" | "title" | "focus" | "durationMinutes" | "exercises"
>>;

export class CoachPlanError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CoachPlanError";
  }
}

export function createCoachPlanDraft(
  state: DemoState,
  input: CoachPlanDraftInput,
  now = new Date(),
): { state: DemoState; plan: DemoCoachWorkoutPlan } {
  const next = cloneState(state);
  const source = input.basedOnPlanId
    ? next.coachPlans.find((plan) => plan.id === input.basedOnPlanId && plan.status === "published")
    : undefined;
  if (input.basedOnPlanId && !source) {
    throw new CoachPlanError("published_plan_not_found", "The published workout used for this draft was not found.");
  }

  const dateKey = input.dateKey ?? source?.dateKey;
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new CoachPlanError("invalid_plan_date", "Enter a valid workout date.");
  }
  const familyId = source?.familyId ?? `coach_plan_${dateKey}_${randomUUID().slice(0, 8)}`;
  const existingDraft = next.coachPlans.find((plan) => plan.familyId === familyId && plan.status === "draft");
  if (existingDraft) throw new CoachPlanError("draft_exists", "A draft already exists for this workout.");

  const timestamp = now.toISOString();
  const plan: DemoCoachWorkoutPlan = {
    id: `coach_plan_draft_${randomUUID()}`,
    familyId,
    dateKey,
    slot: input.slot ?? source?.slot ?? "morning",
    title: input.title ?? source?.title ?? "New workout",
    focus: input.focus ?? source?.focus ?? "",
    version: source?.version ?? 0,
    status: "draft",
    durationMinutes: input.durationMinutes ?? source?.durationMinutes ?? 60,
    exercises: cloneExercises(input.exercises ?? source?.exercises ?? []),
    basedOnPlanId: source?.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  next.coachPlans.push(plan);
  touch(next, timestamp);
  return { state: next, plan };
}

export function editCoachPlanDraft(
  state: DemoState,
  planId: string,
  patch: CoachPlanDraftPatch,
  now = new Date(),
): { state: DemoState; plan: DemoCoachWorkoutPlan } {
  const next = cloneState(state);
  const plan = next.coachPlans.find((candidate) => candidate.id === planId);
  if (!plan) throw new CoachPlanError("plan_not_found", "That coach workout plan was not found.");
  if (plan.status !== "draft") throw new CoachPlanError("published_plan_read_only", "Published workouts cannot be edited. Create a draft revision instead.");
  assertPatchKeys(patch);
  if (patch.dateKey !== undefined) plan.dateKey = patch.dateKey;
  if (patch.slot !== undefined) plan.slot = patch.slot;
  if (patch.title !== undefined) plan.title = patch.title;
  if (patch.focus !== undefined) plan.focus = patch.focus;
  if (patch.durationMinutes !== undefined) plan.durationMinutes = patch.durationMinutes;
  if (patch.exercises !== undefined) plan.exercises = cloneExercises(patch.exercises);
  const timestamp = now.toISOString();
  plan.updatedAt = timestamp;
  touch(next, timestamp);
  return { state: next, plan };
}

export function publishCoachPlanDraft(
  state: DemoState,
  planId: string,
  now = new Date(),
): { state: DemoState; plan: DemoCoachWorkoutPlan } {
  const next = cloneState(state);
  const plan = next.coachPlans.find((candidate) => candidate.id === planId);
  if (!plan) throw new CoachPlanError("plan_not_found", "That coach workout plan was not found.");
  if (plan.status !== "draft") throw new CoachPlanError("plan_already_published", "That workout is already published.");
  validateCoachWorkoutPlan(plan);
  const latestVersion = Math.max(
    0,
    ...next.coachPlans
      .filter((candidate) => candidate.familyId === plan.familyId && candidate.status === "published")
      .map((candidate) => candidate.version),
  );
  const timestamp = now.toISOString();
  plan.version = latestVersion + 1;
  plan.status = "published";
  plan.updatedAt = timestamp;
  plan.publishedAt = timestamp;
  touch(next, timestamp);
  return { state: next, plan };
}

export function validateCoachWorkoutPlan(plan: DemoCoachWorkoutPlan) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.dateKey)) fieldError("dateKey", "Enter a valid workout date.");
  if (!(["morning", "afternoon", "evening"] as const).includes(plan.slot)) fieldError("slot", "Choose a valid workout slot.");
  if (!plan.title.trim()) fieldError("title", "Workout title is required.");
  if (!plan.focus.trim()) fieldError("focus", "Workout focus is required.");
  requireRange(plan.durationMinutes, 1, 240, "durationMinutes", "Duration must be from 1 to 240 minutes.");
  if (!plan.exercises.length) fieldError("exercises", "Add at least one exercise before publishing.");
  const ids = new Set<string>();
  plan.exercises.forEach((exercise, index) => {
    const base = `exercises.${index}`;
    if (!exercise.id || ids.has(exercise.id)) fieldError(`${base}.id`, "Every exercise needs a unique ID.");
    ids.add(exercise.id);
    if (!exercise.name.trim()) fieldError(`${base}.name`, "Exercise name is required.");
    requireRange(exercise.sets, 1, 20, `${base}.sets`, "Sets must be from 1 to 20.");
    if (exercise.reps === undefined && exercise.distanceMeters === undefined) {
      fieldError(`${base}.reps`, "Every exercise requires repetitions or distance.");
    }
    if (exercise.reps !== undefined) requireRange(exercise.reps, 1, 100, `${base}.reps`, "Repetitions must be from 1 to 100.");
    if (exercise.distanceMeters !== undefined) {
      requireRange(exercise.distanceMeters, 1, 200, `${base}.distanceMeters`, "Distance must be from 1 to 200 metres.");
    }
    requireRange(exercise.loadKg, 0, 300, `${base}.loadKg`, "Load must be from 0 to 300 kg.");
    requireRange(exercise.targetRpe, 1, 10, `${base}.targetRpe`, "Target RPE must be from 1 to 10.");
    requireRange(exercise.restSeconds, 0, 600, `${base}.restSeconds`, "Rest must be from 0 to 600 seconds.");
  });
}

function requireRange(value: number, min: number, max: number, field: string, message: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) fieldError(field, message);
}

function fieldError(field: string, message: string): never {
  throw new CoachPlanError(`invalid_${field.replace(/\./g, "_")}`, `${field}: ${message}`);
}

function assertPatchKeys(patch: CoachPlanDraftPatch) {
  const allowed = ["dateKey", "slot", "title", "focus", "durationMinutes", "exercises"];
  if (Object.keys(patch).some((key) => !allowed.includes(key))) {
    throw new CoachPlanError("unknown_plan_field", "The coach plan update contains an unsupported field.");
  }
}

function cloneExercises(exercises: DemoCoachExercise[]) {
  return exercises.map((exercise) => ({ ...exercise }));
}

function cloneState(state: DemoState): DemoState {
  return JSON.parse(JSON.stringify(state)) as DemoState;
}

function touch(state: DemoState, timestamp: string) {
  state.revision += 1;
  state.updatedAt = timestamp;
}
