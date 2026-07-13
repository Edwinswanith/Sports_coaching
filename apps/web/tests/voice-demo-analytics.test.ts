import {
  calculateBenchmarkDeltas,
  compareFirstAndLastTwoWeeks,
  findBestDay,
  getDayDetails,
  getProgressSummary,
} from "../lib/voice-demo/analytics";
import { calculateReadiness, calculateSessionLoad, createSeedDemoState } from "../lib/voice-demo/seed";

describe("voice demo 30-day seed and analytics", () => {
  test("seeds exactly 30 unique ordered dates with required anchors", () => {
    const state = createSeedDemoState();
    expect(state.schemaVersion).toBe(2);
    expect(state.days).toHaveLength(30);
    expect(new Set(state.days.map((day) => day.dateKey))).toHaveProperty("size", 30);
    expect(state.days[0].dateKey).toBe("2026-06-13");
    expect(state.days.at(-1)?.dateKey).toBe("2026-07-12");
    expect(state.days.map((day) => day.dateKey)).toEqual([...state.days.map((day) => day.dateKey)].sort());

    expect(getDayDetails(state, "2026-06-13")?.benchmarks).toMatchObject({
      sprint30m: 4.32, sprint100m: 11.82, verticalJump: 52, farmersWalk40m: 31.5,
    });
    expect(getDayDetails(state, "2026-07-11")?.benchmarks).toMatchObject({
      sprint30m: 4.21, sprint100m: 11.61, verticalJump: 56, farmersWalk40m: 28.8,
    });
    expect(getDayDetails(state, "2026-06-21")?.wellness).toMatchObject({ sleepHours: 4.8, fatigue: 9 });
    expect(getDayDetails(state, "2026-06-29")?.sessions.some((session) => session.status === "partial")).toBe(true);
    expect(getDayDetails(state, "2026-07-05")?.note).toMatch(/deload/i);
  });

  test("uses the exact readiness and session-load formulas", () => {
    expect(calculateReadiness({ sleepHours: 8, sleepQuality: 8, mood: 7, soreness: 3, fatigue: 4 })).toBe(75);
    expect(calculateReadiness({ sleepHours: null, sleepQuality: null, mood: 7, soreness: null, fatigue: null })).toBeNull();
    expect(calculateSessionLoad({ actualDurationMinutes: 45, effortRating: 7 })).toBe(315);
    expect(calculateSessionLoad({ actualDurationMinutes: 45 })).toBeUndefined();
  });

  test("treats lower timed values and higher jump values as improvement", () => {
    const deltas = calculateBenchmarkDeltas(createSeedDemoState().days);
    expect(deltas.find((item) => item.metric === "sprint30m")).toMatchObject({ first: 4.32, last: 4.21, improvement: 0.11 });
    expect(deltas.find((item) => item.metric === "sprint100m")).toMatchObject({ first: 11.82, last: 11.61, improvement: 0.21 });
    expect(deltas.find((item) => item.metric === "verticalJump")).toMatchObject({ first: 52, last: 56, improvement: 4 });
    expect(deltas.find((item) => item.metric === "farmersWalk40m")).toMatchObject({ first: 31.5, last: 28.8, improvement: 2.7 });
  });

  test("finds 10 July as the unique best readiness day", () => {
    const result = findBestDay(createSeedDemoState(), "readiness");
    expect(result?.value).toBe(91);
    expect(result?.days.map((day) => day.dateKey)).toEqual(["2026-07-10"]);
  });

  test("compares exact first and last fourteen-day periods", () => {
    const comparison = compareFirstAndLastTwoWeeks(createSeedDemoState());
    expect(comparison.first.startDate).toBe("2026-06-13");
    expect(comparison.first.endDate).toBe("2026-06-26");
    expect(comparison.last.startDate).toBe("2026-06-29");
    expect(comparison.last.endDate).toBe("2026-07-12");
    expect(comparison.last.averageReadiness).toBeGreaterThan(comparison.first.averageReadiness ?? 0);
  });

  test("returns only deterministic threshold priorities and handles missing days", () => {
    const summary = getProgressSummary(createSeedDemoState(), 30);
    expect(summary.priorities).toEqual(expect.arrayContaining([expect.stringMatching(/hydration goal/i)]));
    expect(summary.priorities.some((priority) => /independently increase/i.test(priority))).toBe(false);
    expect(getDayDetails(createSeedDemoState(), "2026-06-01")).toBeNull();
  });
});
