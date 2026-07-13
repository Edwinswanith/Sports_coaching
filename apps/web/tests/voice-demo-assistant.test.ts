import { resolveAssistantCandidates } from "../lib/voice-demo/assistantPlanner";
import { classifyReadOnlyQuestion, parseSingleWellnessAssignment } from "../lib/voice-demo/assistantRules";
import { createSeedDemoState } from "../lib/voice-demo/seed";
import { getActiveDemoDay } from "../lib/voice-demo/types";
import type { AssistantInterpretation } from "../lib/voice-demo/assistantInterpreter";
import type { AssistantConversationContext } from "../lib/voice-demo/types";

function interpretation(candidates: AssistantInterpretation["candidates"], normalizedQuery = "test query"): AssistantInterpretation {
  return {
    candidates,
    debug: {
      provider: "gemini",
      model: "test-model",
      latencyMs: 12,
      candidateTools: candidates.map((item) => item.tool),
      normalizedQuery,
    },
  };
}

function resolve(tool: AssistantInterpretation["candidates"][number]["tool"], args: Record<string, unknown> = {}, context: AssistantConversationContext = {}, query = "test query") {
  return resolveAssistantCandidates(createSeedDemoState(), interpretation([{ tool, arguments: args }], query), context);
}

describe("voice demo assistant analytics and conversation", () => {
  test("builds daily status from the active stored day without a plan", () => {
    const resolved = resolve("get_daily_status");
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("750 ml");
    expect(resolved.response.message).toContain("sleep quality");
    expect(resolved.plan).toBeUndefined();
  });

  test("classifies natural status, progress, and coach-message questions", () => {
    expect(classifyReadOnlyQuestion("How's my status?")).toBe("daily_status");
    expect(classifyReadOnlyQuestion("How am I progressing?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("What should I improve?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("Did coach sent any message?")).toBe("coach_update");
  });

  test("answers monthly progress with all benchmark deltas and exact range", () => {
    const resolved = resolve("get_progress_summary", { rangeDays: 30 }, {}, "how did i progress this month");
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("13 Jun 2026");
    expect(resolved.response.message).toContain("12 Jul 2026");
    expect(resolved.response.message).toContain("4.32 s → 4.21 s");
    expect(resolved.response.message).toContain("11.82 s → 11.61 s");
    expect(resolved.response.message).toContain("52 cm → 56 cm");
    expect(resolved.response.message).toContain("31.5 s → 28.8 s");
    expect(resolved.plan).toBeUndefined();
  });

  test("compares first and last two-week periods from stored data", () => {
    const resolved = resolve("compare_periods");
    expect(resolved.response.kind).toBe("answer");
    if (resolved.response.kind !== "answer") throw new Error("Expected answer");
    expect(resolved.response.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "First period", value: expect.stringContaining("13 Jun 2026") }),
      expect.objectContaining({ label: "Last period", value: expect.stringContaining("12 Jul 2026") }),
    ]));
    expect(resolved.plan).toBeUndefined();
  });

  test("asks for a metric when best day is ambiguous", () => {
    const resolved = resolve("find_best_day");
    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/readiness, sprint, strength, or training completion/i);
  });

  test("returns 10 July readiness 91 with supporting wellness values", () => {
    const resolved = resolve("find_best_day", { metric: "readiness" });
    expect(resolved.response.kind).toBe("answer");
    if (resolved.response.kind !== "answer") throw new Error("Expected answer");
    expect(resolved.response.message).toContain("10 Jul 2026");
    expect(resolved.response.message).toContain("91/100");
    expect(resolved.response.context).toMatchObject({ metric: "readiness", dateKey: "2026-07-10" });
    expect(resolved.response.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Sleep", value: expect.stringContaining("8.4 h") }),
      expect.objectContaining({ label: "Fatigue", value: "1.8/10" }),
    ]));
  });

  test("uses the prior best-day context for Why", () => {
    const context: AssistantConversationContext = { topic: "best_day", metric: "readiness", dateKey: "2026-07-10" };
    const resolved = resolve("get_day_details", { dateKey: "2026-07-10" }, context, "why");
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("readiness 91/100 because");
    expect(resolved.response.context.dateKey).toBe("2026-07-10");
  });

  test("returns only deterministic improvement priorities", () => {
    const resolved = resolve("get_progress_summary", { rangeDays: 30 }, {}, "what should i improve");
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toMatch(/hydration goal/i);
    expect(resolved.response.message).toMatch(/not a prescription/i);
  });

  test("reports historical evidence and coach plan without prescribing workouts", () => {
    const resolved = resolve("evaluate_intensity_question", { mode: "continue" });
    expect(resolved.response.kind).toBe("answer");
    if (resolved.response.kind !== "answer") throw new Error("Expected answer");
    expect(resolved.response.message).toContain("Coach Priya’s published continuation plan");
    expect(resolved.response.message).toContain("won’t independently choose or prescribe workouts");
    expect(resolved.response.debug.safetyDecision).toMatch(/No workout was independently prescribed/i);
  });

  test("requires Coach Priya approval for intensity changes", () => {
    const resolved = resolve("evaluate_intensity_question", { mode: "increase" });
    expect(resolved.response.kind).toBe("answer");
    if (resolved.response.kind !== "answer") throw new Error("Expected answer");
    expect(resolved.response.message).toContain("Coach Priya must approve any change");
    expect(resolved.response.suggestions?.[0]).toMatch(/Message my coach/i);
    expect(resolved.response.debug.safetyDecision).toMatch(/approval is required/i);
  });

  test("shows the published Monday plan and not a draft", () => {
    const resolved = resolve("get_coach_workout_plan", { dateKey: "2026-07-13" });
    expect(resolved.response.kind).toBe("answer");
    if (resolved.response.kind !== "answer") throw new Error("Expected answer");
    expect(resolved.response.message).toContain("Strongman conditioning");
    expect(resolved.response.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Exercise", value: "Farmer’s walk" }),
      expect.objectContaining({ label: "Exercise", value: "Tire flip" }),
      expect.objectContaining({ label: "Exercise", value: "Sled push" }),
    ]));
    expect(resolved.response.context.planId).toBe("coach_plan_2026-07-13_v1");
  });

  test.each([
    ["tire flip", "5 sets of 6 reps", "80 kg", "RPE 8"],
    ["farmer's walk", "4 sets of 30 metres", "24 kg per hand", "RPE 7"],
    ["sled push", "6 sets of 20 metres", "60 kg", "RPE 7"],
  ])("explains the published %s prescription", (exerciseReference, volume, load, rpe) => {
    const resolved = resolve("explain_exercise_prescription", { exerciseReference });
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain(volume);
    expect(resolved.response.message).toContain(load);
    expect(resolved.response.message).toContain(rpe);
  });

  test("uses published plan context for the sled follow-up", () => {
    const resolved = resolve(
      "explain_exercise_prescription",
      { exerciseReference: "sled push", planId: "coach_plan_2026-07-13_v1" },
      { topic: "exercise", planId: "coach_plan_2026-07-13_v1", exerciseId: "exercise_2026-07-13_farmers_walk" },
      "and the sled",
    );
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("6 sets of 20 metres");
    expect(resolved.response.context.exerciseId).toBe("exercise_2026-07-13_sled_push");
  });

  test("does not invent values for an unrecorded day", () => {
    const resolved = resolve("get_day_details", { dateKey: "2026-06-01" });
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toMatch(/don’t have recorded data/i);
    expect(resolved.response.message).toMatch(/won’t invent/i);
    expect(resolved.plan).toBeUndefined();
  });

  test("answers coach-message questions from stored messages", () => {
    const resolved = resolve("get_coach_update");
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("Coach Priya");
    expect(resolved.response.message).toContain("Monday’s strongman session is published");
  });
});

describe("voice demo assistant write regressions", () => {
  test("creates a water plan without changing state", () => {
    const state = createSeedDemoState();
    const resolved = resolveAssistantCandidates(state, interpretation([{ tool: "add_water", arguments: { amountMl: 250 } }]));
    expect(resolved.response.kind).toBe("plan");
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "add_water", arguments: { amountMl: 250 } });
    expect(getActiveDemoDay(state).hydration.totalMl).toBe(750);
  });

  test("wellness plan contains only explicitly extracted fields", () => {
    const resolved = resolve("record_wellness", { sleepQuality: 8 });
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "record_wellness", arguments: { sleepQuality: 8 } });
    expect(resolved.plan?.displayFields).toEqual([{ label: "sleep quality", value: "8 / 10" }]);
  });

  test("sleep quantity commands create a sleep-hours plan", () => {
    expect(parseSingleWellnessAssignment("Saved the sleep quantity up to seven hours.")).toEqual({ field: "sleepHours", value: 7 });
    expect(parseSingleWellnessAssignment("Save this screen quantity to seven hours.")).toEqual({ field: "sleepHours", value: 7 });

    const resolved = resolve("record_wellness", { sleepHours: 7 });
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "record_wellness", arguments: { sleepHours: 7 } });
    expect(resolved.plan?.displayFields).toEqual([{ label: "sleep hours", value: "7 h" }]);
  });

  test("generic wellness score asks which field instead of guessing", () => {
    const resolved = resolve("record_wellness", { wellnessScore: 2 });
    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/Which wellness field should receive 2\/10/i);
  });

  test("parses invalid natural wellness values for targeted clarification", () => {
    expect(parseSingleWellnessAssignment("muscle soreness as a volcano")).toEqual({ field: "soreness", value: "a volcano" });
    expect(parseSingleWellnessAssignment("soreness to 100")).toEqual({ field: "soreness", value: 100 });
    const resolved = resolve("record_wellness", { soreness: 100 });
    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/whole number from 1 to 10/i);
  });

  test("ambiguous training asks which session instead of selecting morning", () => {
    const resolved = resolve("update_training_session", { status: "completed" });
    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/two incomplete sessions/i);
  });

  test("explicit evening training resolves only the evening session", () => {
    const resolved = resolve("update_training_session", { sessionReference: "evening strength", status: "completed", sets: 4, reps: 8, effort: 7 });
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "update_training_session", arguments: { sessionId: "session_demo_pm", status: "completed", sets: 4, reps: 8, effort: 7 } });
  });

  test("uses explicit session words from the normalized query when Gemini omits the reference", () => {
    const resolved = resolve(
      "update_training_session",
      { status: "completed", sets: 4, reps: 8, effort: 7 },
      {},
      "please note that the evening strength work is finished with four sets of eight and effort seven",
    );
    expect(resolved.response.kind).toBe("plan");
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "update_training_session", arguments: { sessionId: "session_demo_pm" } });
  });

  test("compound candidates produce clarification and no plan", () => {
    const resolved = resolveAssistantCandidates(createSeedDemoState(), interpretation([
      { tool: "update_training_session", arguments: { sessionReference: "evening", status: "completed" } },
      { tool: "add_water", arguments: { amountMl: 500 } },
    ]));
    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.plan).toBeUndefined();
  });

  test("coach message plan preserves exact body and assigned coach", () => {
    const resolved = resolve("send_coach_message", { body: "I completed evening strength." });
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "send_coach_message", arguments: { coachId: "coach_demo_priya", body: "I completed evening strength." } });
  });
});
