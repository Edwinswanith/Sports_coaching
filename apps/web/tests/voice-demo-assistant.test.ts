import { resolveAssistantCandidates } from "../lib/voice-demo/assistantPlanner";
import { classifyReadOnlyQuestion, parseSingleWellnessAssignment } from "../lib/voice-demo/assistantRules";
import { createSeedDemoState } from "../lib/voice-demo/seed";
import type { AssistantInterpretation } from "../lib/voice-demo/assistantInterpreter";

function interpretation(
  candidates: AssistantInterpretation["candidates"],
): AssistantInterpretation {
  return {
    candidates,
    debug: { provider: "gemini", model: "test-model", latencyMs: 12, candidateTools: candidates.map((item) => item.tool) },
  };
}

describe("voice demo assistant planner", () => {
  test("builds daily status from stored state", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "get_daily_status", arguments: {} }]),
    );

    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("750 ml");
    expect(resolved.response.message).toContain("sleep quality");
    expect(resolved.plan).toBeUndefined();
  });

  test("classifies natural status and progress questions", () => {
    expect(classifyReadOnlyQuestion("How's my status?")).toBe("daily_status");
    expect(classifyReadOnlyQuestion("How am I progressing?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("What is my progress?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("Am I on the right path?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("What should I improve?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("What are the things I need to improve?")).toBe("progress_guidance");
    expect(classifyReadOnlyQuestion("Did coach sent any message?")).toBe("coach_update");
    expect(classifyReadOnlyQuestion("What did my coach say?")).toBe("coach_update");
  });

  test("builds grounded progress guidance from stored state", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "get_progress_guidance", arguments: {} }]),
    );

    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("750 ml of 3,000 ml");
    expect(resolved.response.message).toContain("today’s data");
    expect(resolved.response.message).toContain("can’t reliably judge a long-term");
    expect(resolved.response.message).toContain("Coach Priya");
    expect(resolved.plan).toBeUndefined();
  });

  test("answers coach-message questions from stored messages", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "get_coach_update", arguments: {} }]),
    );

    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toContain("Coach Priya");
    expect(resolved.response.message).toContain("Focus on clean form today");
    expect(resolved.plan).toBeUndefined();
  });

  test("reports clearly when the coach has not sent a message", () => {
    const state = createSeedDemoState();
    state.coach.messages = [];
    const resolved = resolveAssistantCandidates(
      state,
      interpretation([{ tool: "get_coach_update", arguments: {} }]),
    );

    expect(resolved.response.kind).toBe("answer");
    expect(resolved.response.message).toMatch(/hasn’t sent you a message yet/i);
  });

  test("creates a water plan without changing state", () => {
    const state = createSeedDemoState();
    const resolved = resolveAssistantCandidates(
      state,
      interpretation([{ tool: "add_water", arguments: { amountMl: 250 } }]),
    );

    expect(resolved.response.kind).toBe("plan");
    expect(resolved.plan?.toolCall).toMatchObject({ tool: "add_water", arguments: { amountMl: 250 } });
    expect(state.hydration.totalMl).toBe(750);
  });

  test("wellness plan contains only explicitly extracted fields", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "record_wellness", arguments: { sleepQuality: 8 } }]),
    );

    expect(resolved.plan?.toolCall).toMatchObject({
      tool: "record_wellness",
      arguments: { sleepQuality: 8 },
    });
    expect(resolved.plan?.displayFields).toEqual([{ label: "sleep quality", value: "8 / 10" }]);
  });

  test("generic wellness score asks which field instead of guessing", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "record_wellness", arguments: { wellnessScore: 2 } }]),
    );

    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/Which wellness field should receive 2\/10/i);
    expect(resolved.response.kind === "clarification" ? resolved.response.options : []).toContain("Soreness 2");
    expect(resolved.plan).toBeUndefined();
  });

  test("parses one wellness field even when its value is nonnumeric", () => {
    expect(parseSingleWellnessAssignment("muscle soreness as a volcano")).toEqual({
      field: "soreness",
      value: "a volcano",
    });
    expect(parseSingleWellnessAssignment("soreness to 100")).toEqual({ field: "soreness", value: 100 });
    expect(parseSingleWellnessAssignment("sleep qality as 7")).toEqual({ field: "sleepQuality", value: 7 });
  });

  test("invalid soreness values trigger a targeted numeric clarification", () => {
    for (const argumentsValue of [{ soreness: 100 }, { wellnessField: "soreness", wellnessValue: "a volcano" }]) {
      const resolved = resolveAssistantCandidates(
        createSeedDemoState(),
        interpretation([{ tool: "record_wellness", arguments: argumentsValue }]),
      );

      expect(resolved.response.kind).toBe("clarification");
      expect(resolved.response.message).toMatch(/soreness only as a whole number from 1 to 10/i);
      expect(resolved.response.kind === "clarification" ? resolved.response.options : []).toContain("Soreness 7");
      expect(resolved.plan).toBeUndefined();
    }
  });

  test("ambiguous training asks which session instead of selecting morning", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "update_training_session", arguments: { status: "completed" } }]),
    );

    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/two incomplete sessions/i);
    expect(resolved.plan).toBeUndefined();
  });

  test("explicit evening training resolves only the evening session", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([
        {
          tool: "update_training_session",
          arguments: { sessionReference: "evening strength", status: "completed", sets: 4, reps: 8, effort: 7 },
        },
      ]),
    );

    expect(resolved.plan?.toolCall).toMatchObject({
      tool: "update_training_session",
      arguments: { sessionId: "session_demo_pm", status: "completed", sets: 4, reps: 8, effort: 7 },
    });
  });

  test("rejects an implausible water amount", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "add_water", arguments: { amountMl: 50_000 } }]),
    );

    expect(resolved.response.kind).toBe("unsupported");
    expect(resolved.response.message).toContain("50–5,000 ml");
  });

  test("compound candidates produce clarification and no plan", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([
        { tool: "update_training_session", arguments: { sessionReference: "evening", status: "completed" } },
        { tool: "add_water", arguments: { amountMl: 500 } },
      ]),
    );

    expect(resolved.response.kind).toBe("clarification");
    expect(resolved.response.message).toMatch(/2 actions/i);
    expect(resolved.plan).toBeUndefined();
  });

  test("coach message plan preserves exact body and assigned coach", () => {
    const resolved = resolveAssistantCandidates(
      createSeedDemoState(),
      interpretation([{ tool: "send_coach_message", arguments: { body: "I completed evening strength." } }]),
    );

    expect(resolved.plan?.toolCall).toMatchObject({
      tool: "send_coach_message",
      arguments: { coachId: "coach_demo_priya", body: "I completed evening strength." },
    });
  });
});
