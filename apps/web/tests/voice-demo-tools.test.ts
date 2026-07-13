import { createSeedDemoState } from "../lib/voice-demo/seed";
import { DemoToolError, executeDemoTool } from "../lib/voice-demo/tools";
import { getActiveDemoDay } from "../lib/voice-demo/types";

describe("voice demo deterministic tools", () => {
  test("adds water once and returns the stored result for the same operation ID", () => {
    const initial = createSeedDemoState();
    const call = { operationId: "operation_water_1", tool: "add_water" as const, arguments: { amountMl: 250 } };

    const first = executeDemoTool(initial, call);
    const retry = executeDemoTool(first.state, call);

    expect(getActiveDemoDay(initial).hydration.totalMl).toBe(750);
    expect(getActiveDemoDay(first.state).hydration.totalMl).toBe(1000);
    expect(getActiveDemoDay(first.state).hydration.entries).toHaveLength(1);
    expect(getActiveDemoDay(retry.state).hydration.totalMl).toBe(1000);
    expect(getActiveDemoDay(retry.state).hydration.entries).toHaveLength(1);
    expect(retry.result.changed).toBe(false);
  });

  test("updates only explicitly supplied wellness values", () => {
    const initial = createSeedDemoState();
    const outcome = executeDemoTool(initial, {
      operationId: "operation_wellness_1",
      tool: "record_wellness",
      arguments: { sleepQuality: 8 },
    });

    expect(getActiveDemoDay(outcome.state).wellness).toEqual({
      sleepHours: null,
      sleepQuality: 8,
      mood: 7,
      soreness: null,
      fatigue: null,
    });
    expect(outcome.result.message).toMatch(/Unmentioned wellness values were left unchanged/);
  });

  test("rejects invalid wellness and water values", () => {
    expect(() =>
      executeDemoTool(createSeedDemoState(), {
        operationId: "operation_invalid_wellness",
        tool: "record_wellness",
        arguments: { fatigue: 15 },
      }),
    ).toThrow(DemoToolError);

    expect(() =>
      executeDemoTool(createSeedDemoState(), {
        operationId: "operation_invalid_water",
        tool: "add_water",
        arguments: { amountMl: 50_000 },
      }),
    ).toThrow("Enter a whole number from 50 to 5000");
  });

  test("updates the selected training session without changing the other session", () => {
    const outcome = executeDemoTool(createSeedDemoState(), {
      operationId: "operation_training_1",
      tool: "update_training_session",
      arguments: {
        sessionId: "session_demo_pm",
        status: "completed",
        sets: 4,
        reps: 8,
        effort: 7,
      },
    });

    expect(getActiveDemoDay(outcome.state).sessions.find((session) => session.id === "session_demo_pm")).toMatchObject({
      status: "completed",
      sets: 4,
      reps: 8,
      effortRating: 7,
    });
    expect(getActiveDemoDay(outcome.state).sessions.find((session) => session.id === "session_demo_am")?.status).toBe("planned");
  });

  test("rejects an unknown training session instead of defaulting to morning", () => {
    expect(() =>
      executeDemoTool(createSeedDemoState(), {
        operationId: "operation_unknown_session",
        tool: "update_training_session",
        arguments: { sessionId: "session_missing", status: "completed" },
      }),
    ).toThrow("That training session does not exist");
  });

  test("saves only allowlisted recovery modalities", () => {
    const outcome = executeDemoTool(createSeedDemoState(), {
      operationId: "operation_recovery_1",
      tool: "record_recovery",
      arguments: { modalities: ["Stretching", "Mobility"] },
    });

    expect(getActiveDemoDay(outcome.state).recovery.modalities).toEqual(["Stretching", "Mobility"]);
  });

  test("sends one exact message only to the assigned coach", () => {
    const initial = createSeedDemoState();
    const call = {
      operationId: "operation_message_1",
      tool: "send_coach_message" as const,
      arguments: { coachId: "coach_demo_priya", body: "I completed evening strength." },
    };
    const first = executeDemoTool(initial, call);
    const retry = executeDemoTool(first.state, call);

    expect(first.state.coach.messages).toHaveLength(3);
    expect(first.state.coach.messages.at(-1)?.body).toBe("I completed evening strength.");
    expect(retry.state.coach.messages).toHaveLength(3);

    expect(() =>
      executeDemoTool(initial, {
        operationId: "operation_message_wrong_coach",
        tool: "send_coach_message",
        arguments: { coachId: "coach_unassigned", body: "Hello" },
      }),
    ).toThrow("not assigned");
  });
});
