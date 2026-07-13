jest.mock("server-only", () => ({}));

import {
  executeAthleteAnalyticsQuery,
  validateAthleteAnalyticsQuery,
} from "../lib/voice-demo/analyticsQuery";
import { humanizeAnalyticsTurn, validateHumanizedMessage } from "../lib/voice-demo/assistantHumanizer";
import { sanitizeAssistantContext } from "../lib/voice-demo/assistantContext";
import { interpretAssistantMessage } from "../lib/voice-demo/assistantInterpreter";
import { resolveAssistantCandidates } from "../lib/voice-demo/assistantPlanner";
import { createSeedDemoState } from "../lib/voice-demo/seed";
import type { AssistantInterpretation } from "../lib/voice-demo/assistantInterpreter";

describe("typed athlete analytics queries", () => {
  test("derives a challenging day at query time without stored best or worst labels", () => {
    const state = createSeedDemoState();
    expect(state.days.every((day) => !("best" in day) && !("worst" in day) && !("performanceLabel" in day))).toBe(true);
    const validation = validateAthleteAnalyticsQuery({ goal: "difficult_days", metrics: [] }, state);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("Expected a valid query");

    const before = JSON.stringify(state);
    const analysis = executeAthleteAnalyticsQuery(state, validation.query);
    expect(analysis.context.dateKey).toBe("2026-06-21");
    expect(analysis.message).toContain("runtime comparison");
    expect(analysis.message).toContain("No performance benchmark was recorded");
    expect(JSON.stringify(state)).toBe(before);
  });

  test("excludes the incomplete current day from historical day ranking", () => {
    const state = createSeedDemoState();
    const validation = validateAthleteAnalyticsQuery({ goal: "difficult_days", metrics: ["hydrationPercent", "trainingCompletion"] }, state);
    if (!validation.ok) throw new Error("Expected a valid query");
    const analysis = executeAthleteAnalyticsQuery(state, validation.query);
    expect(analysis.context.dateKey).not.toBe(state.athlete.dateKey);
  });

  test("calculates relationships from paired observations without claiming causation", () => {
    const state = createSeedDemoState();
    const validation = validateAthleteAnalyticsQuery({ goal: "relationship", metrics: ["sleepQuality", "readiness"], rangeDays: 30 }, state);
    if (!validation.ok) throw new Error("Expected a valid query");
    const analysis = executeAthleteAnalyticsQuery(state, validation.query);
    expect(analysis.coverage.pairedObservations).toBeGreaterThanOrEqual(20);
    expect(analysis.message).toMatch(/association/i);
    expect(analysis.message).toMatch(/not proof/i);
  });

  test("validates range, metric, relationship, neutral-load, and unknown-field boundaries", () => {
    const state = createSeedDemoState();
    expect(validateAthleteAnalyticsQuery({ goal: "relationship", metrics: ["sleepQuality"] }, state)).toMatchObject({ ok: false, kind: "clarification" });
    expect(validateAthleteAnalyticsQuery({ goal: "difficult_days", metrics: ["trainingLoad"] }, state)).toMatchObject({ ok: false, kind: "clarification" });
    expect(validateAthleteAnalyticsQuery({ goal: "overview", metrics: ["imaginaryMetric"] }, state)).toMatchObject({ ok: false, kind: "unsupported" });
    expect(validateAthleteAnalyticsQuery({ goal: "overview", metrics: [], startDate: "2026-06-01", endDate: "2026-06-12" }, state)).toMatchObject({ ok: false, kind: "unsupported" });
    expect(validateAthleteAnalyticsQuery({ goal: "overview", metrics: [], athleteId: "another-athlete" }, state)).toMatchObject({ ok: false, kind: "unsupported" });
  });

  test("compares recorded periods around a validated contextual date", () => {
    const state = createSeedDemoState();
    const validation = validateAthleteAnalyticsQuery({ goal: "trend", metrics: ["readiness", "fatigue"], anchorDate: "2026-06-21" }, state);
    if (!validation.ok) throw new Error("Expected a valid query");
    const analysis = executeAthleteAnalyticsQuery(state, validation.query);
    expect(analysis.message).toContain("14 Jun 2026–20 Jun 2026");
    expect(analysis.message).toContain("22 Jun 2026–28 Jun 2026");
  });

  test("keeps only allowlisted, recorded conversation references", () => {
    const state = createSeedDemoState();
    const context = sanitizeAssistantContext({
      topic: "analytics",
      analysisGoal: "difficult_days",
      metrics: ["readiness", "imaginaryMetric", "fatigue"],
      rangeStart: "2026-06-13",
      rangeEnd: "2099-01-01",
      dateKey: "2099-01-01",
      planId: "forged-plan",
      athleteId: "another-athlete",
    }, state);
    expect(context).toEqual({
      topic: "analytics",
      analysisGoal: "difficult_days",
      metrics: ["readiness", "fatigue"],
    });
  });
});

describe("analytics interpretation and evidence-locked humanization", () => {
  test("routes natural difficult-day and relationship questions into typed analytics", async () => {
    const state = createSeedDemoState();
    const difficult = await interpretAssistantMessage("Which day I didn't perform well?", state);
    expect(difficult.candidates).toEqual([{ tool: "analyze_athlete_data", arguments: { goal: "difficult_days", metrics: [] } }]);

    const relationship = await interpretAssistantMessage("Did sleep quality move with readiness this month?", state);
    expect(relationship.candidates).toEqual([{
      tool: "analyze_athlete_data",
      arguments: { goal: "relationship", metrics: ["readiness", "sleepQuality"], rangeDays: 30 },
    }]);
  });

  test("returns a read-only answer with the validated query and grounding facts", () => {
    const state = createSeedDemoState();
    const interpretation: AssistantInterpretation = {
      candidates: [{ tool: "analyze_athlete_data", arguments: { goal: "difficult_days", metrics: [] } }],
      debug: { provider: "gemini", model: "test", latencyMs: 10, candidateTools: ["analyze_athlete_data"], normalizedQuery: "which day did not go well" },
    };
    const before = JSON.stringify(state);
    const resolved = resolveAssistantCandidates(state, interpretation);
    expect(resolved.response.kind).toBe("answer");
    expect(resolved.plan).toBeUndefined();
    if (resolved.response.kind !== "answer") throw new Error("Expected an answer");
    expect(resolved.response.debug.analysisQuery?.goal).toBe("difficult_days");
    expect(resolved.response.debug.groundingFacts?.length).toBeGreaterThan(2);
    expect(resolved.response.debug.safetyDecision).toMatch(/no default values/i);
    expect(JSON.stringify(state)).toBe(before);
  });

  test("replaces approved evidence tokens with deterministic facts", async () => {
    const turn = groundedTurn();
    const humanized = await humanizeAnalyticsTurn(
      turn,
      "Which day did not go well?",
      async () => "Here’s what stood out in your records: {{E1}}. The supporting context is {{E2}}. I’m treating this as a recorded pattern, not a permanent label.",
    );
    expect(humanized.message).toContain("21 Jun 2026");
    expect(humanized.message).toContain("49/100");
    expect(humanized.message).not.toMatch(/\{\{E\d+\}\}/);
    expect(humanized.kind === "answer" && humanized.debug.humanizer).toBe("gemini");
  });

  test("rejects fabricated numbers, causal language, prescriptions, and unknown evidence tokens", async () => {
    const turn = groundedTurn();
    for (const unsafe of [
      "Your readiness was 99/100, so this was a bad day. {{E1}}",
      "{{E1}} caused {{E2}}.",
      "Based on {{E1}}, you should increase your training load.",
      "The evidence is {{E99}}.",
    ]) {
      const humanized = await humanizeAnalyticsTurn(turn, "Analyze this", async () => unsafe);
      expect(humanized.message).toBe(turn.message);
      expect(humanized.kind === "answer" && humanized.debug.humanizer).toBe("deterministic_fallback");
    }
    expect(validateHumanizedMessage("Readiness was 99. {{E1}}", groundedFacts())).toBeNull();
  });
});

function groundedFacts() {
  return [
    { id: "E1", label: "Most challenging date", value: "21 Jun 2026", dateKey: "2026-06-21" },
    { id: "E2", label: "Readiness", value: "49/100", dateKey: "2026-06-21" },
  ];
}

function groundedTurn() {
  return {
    kind: "answer" as const,
    message: "Deterministic fallback answer.",
    context: { topic: "analytics" as const },
    evidence: [
      { label: "Challenging pattern", value: "21 Jun 2026", dateKey: "2026-06-21" },
      { label: "Readiness", value: "49/100", dateKey: "2026-06-21" },
    ],
    debug: {
      provider: "deterministic" as const,
      latencyMs: 1,
      candidateTools: ["analyze_athlete_data"],
      analysisQuery: { goal: "difficult_days" as const, metrics: ["readiness" as const], rangeDays: 30 as const, limit: 3 },
      groundingFacts: groundedFacts(),
    },
  };
}
