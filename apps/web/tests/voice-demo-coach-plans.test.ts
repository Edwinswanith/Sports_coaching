import { createCoachPlanDraft, editCoachPlanDraft, publishCoachPlanDraft } from "../lib/voice-demo/coachPlans";
import { getPublishedCoachPlan } from "../lib/voice-demo/analytics";
import { createSeedDemoState } from "../lib/voice-demo/seed";

describe("voice demo coach plan publishing", () => {
  test("seeds the approved 13 July strongman prescription", () => {
    const plan = getPublishedCoachPlan(createSeedDemoState(), "2026-07-13");
    expect(plan?.exercises).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Farmer’s walk", sets: 4, distanceMeters: 30, loadKg: 24, targetRpe: 7, restSeconds: 90 }),
      expect.objectContaining({ name: "Tire flip", sets: 5, reps: 6, loadKg: 80, targetRpe: 8, restSeconds: 120 }),
      expect.objectContaining({ name: "Sled push", sets: 6, distanceMeters: 20, loadKg: 60, targetRpe: 7, restSeconds: 90 }),
    ]));
  });

  test("keeps the published version visible while a revision draft is edited", () => {
    const initial = createSeedDemoState();
    const published = getPublishedCoachPlan(initial, "2026-07-13")!;
    const drafted = createCoachPlanDraft(initial, { basedOnPlanId: published.id }, new Date("2026-07-12T13:00:00Z"));
    const exercises = drafted.plan.exercises.map((exercise) => exercise.name === "Sled push" ? { ...exercise, loadKg: 65 } : exercise);
    const edited = editCoachPlanDraft(drafted.state, drafted.plan.id, { exercises });

    expect(getPublishedCoachPlan(edited.state, "2026-07-13")?.exercises.find((exercise) => exercise.name === "Sled push")?.loadKg).toBe(60);
    expect(edited.plan.exercises.find((exercise) => exercise.name === "Sled push")?.loadKg).toBe(65);
  });

  test("publishes the revision as the next athlete-visible version", () => {
    const initial = createSeedDemoState();
    const published = getPublishedCoachPlan(initial, "2026-07-13")!;
    const draft = createCoachPlanDraft(initial, { basedOnPlanId: published.id }).plan;
    const draftedState = createCoachPlanDraft(initial, { basedOnPlanId: published.id });
    const outcome = publishCoachPlanDraft(draftedState.state, draftedState.plan.id, new Date("2026-07-12T14:00:00Z"));
    expect(draft.status).toBe("draft");
    expect(outcome.plan.version).toBe(2);
    expect(getPublishedCoachPlan(outcome.state, "2026-07-13")?.id).toBe(outcome.plan.id);
  });

  test.each([
    ["RPE", { targetRpe: 11 }, /targetRpe/i],
    ["load", { loadKg: 301 }, /loadKg/i],
    ["repetitions", { reps: 101, distanceMeters: undefined }, /reps/i],
  ])("rejects invalid %s with a field-specific publishing error", (_label, exercisePatch, message) => {
    const initial = createSeedDemoState();
    const source = getPublishedCoachPlan(initial, "2026-07-13")!;
    const drafted = createCoachPlanDraft(initial, { basedOnPlanId: source.id });
    const exercises = drafted.plan.exercises.map((exercise, index) => index === 0 ? { ...exercise, ...exercisePatch } : exercise);
    const edited = editCoachPlanDraft(drafted.state, drafted.plan.id, { exercises });
    expect(() => publishCoachPlanDraft(edited.state, edited.plan.id)).toThrow(message);
  });
});
