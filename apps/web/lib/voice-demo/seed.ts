import {
  DEMO_SCHEMA_VERSION,
  type DemoCoachWorkoutPlan,
  type DemoDay,
  type DemoPerformanceBenchmarks,
  type DemoSession,
  type DemoState,
  type DemoWellness,
} from "./types";

const START_DATE = "2026-06-13";
const DAY_COUNT = 30;

export function calculateReadiness(wellness: DemoWellness): number | null {
  const values = [wellness.sleepQuality, wellness.mood, wellness.soreness, wellness.fatigue];
  if (values.some((value) => value === null)) return null;
  const [sleepQuality, mood, soreness, fatigue] = values as number[];
  return Math.round(((sleepQuality + mood + (11 - soreness) + (11 - fatigue)) / 4) * 10);
}

export function calculateSessionLoad(session: Pick<DemoSession, "actualDurationMinutes" | "effortRating">): number | undefined {
  if (session.actualDurationMinutes === undefined || session.effortRating === undefined) return undefined;
  return session.actualDurationMinutes * session.effortRating;
}

export function createSeedDemoState(): DemoState {
  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    revision: 1,
    athlete: {
      id: "athlete_demo_aarav",
      name: "Aarav Sharma",
      initials: "AS",
      sport: "Sprinter",
      squad: "Development squad",
      timezone: "Asia/Kolkata",
      dateKey: "2026-07-12",
    },
    days: Array.from({ length: DAY_COUNT }, (_, index) => buildDay(index)),
    coach: {
      id: "coach_demo_priya",
      name: "Coach Priya",
      latestGuidance:
        "Keep Monday’s strongman work controlled at the published loads. Quality movement matters more than increasing weight.",
      messages: [
        {
          id: "message_demo_coach_1",
          sender: "coach",
          body: "Focus on clean form today. Keep the final two reps controlled in this evening’s strength session.",
          createdAt: "2026-07-12T08:05:00+05:30",
        },
        {
          id: "message_demo_coach_2",
          sender: "coach",
          body: "Monday’s strongman session is published. Stay at the prescribed load and tell me if RPE goes above the target.",
          createdAt: "2026-07-12T18:10:00+05:30",
        },
      ],
    },
    coachPlans: createSeedCoachPlans(),
    activity: [],
    operations: [],
    assistantPlans: [],
    updatedAt: "2026-07-12T18:20:00+05:30",
  };
}

function buildDay(index: number): DemoDay {
  const dateKey = addDays(START_DATE, index);
  if (dateKey === "2026-07-12") return buildToday();

  const sleepQuality = round1(6.2 + index * 0.075 + ((index % 4) - 1.5) * 0.18);
  const mood = round1(6.5 + index * 0.065 + ((index % 5) - 2) * 0.12);
  const soreness = round1(5.4 - index * 0.055 + ((index % 3) - 1) * 0.25);
  const fatigue = round1(5.7 - index * 0.06 + ((index % 4) - 1.5) * 0.2);
  const wellness: DemoWellness = {
    sleepHours: round1(6.5 + index * 0.035 + (index % 3) * 0.12),
    sleepQuality,
    mood,
    soreness,
    fatigue,
  };

  if (dateKey === "2026-06-21") {
    Object.assign(wellness, { sleepHours: 4.8, sleepQuality: 4, mood: 5, soreness: 7, fatigue: 9 });
  }
  if (dateKey === "2026-07-10") {
    Object.assign(wellness, { sleepHours: 8.4, sleepQuality: 9.2, mood: 9, soreness: 2, fatigue: 1.8 });
  }

  const hydrationGoal = 3000;
  const hydrationTotal = dateKey === "2026-06-21"
    ? 1900
    : Math.min(hydrationGoal + 200, 2200 + index * 31 + (index % 4) * 120);
  const sessions = buildHistoricalSessions(dateKey, index);
  const modalities = index % 3 === 0 ? (["Mobility", "Stretching"] as const) : (["Stretching"] as const);
  return {
    dateKey,
    wellness,
    hydration: { totalMl: hydrationTotal, goalMl: hydrationGoal, entries: [] },
    readiness: calculateReadiness(wellness),
    recovery: { modalities: [...modalities], score: Math.min(94, 62 + index + modalities.length * 3) },
    sessions,
    benchmarks: benchmarkForDate(dateKey),
    note: dateKey === "2026-06-21"
      ? "Reduced output after poor sleep; coach kept the following day easy."
      : dateKey === "2026-06-29"
        ? "Strength session stopped early because fatigue was above target."
        : dateKey === "2026-07-05"
          ? "Planned deload completed at reduced duration and load."
          : undefined,
  };
}

function buildToday(): DemoDay {
  const wellness: DemoWellness = {
    sleepHours: null,
    sleepQuality: null,
    mood: 7,
    soreness: null,
    fatigue: null,
  };
  return {
    dateKey: "2026-07-12",
    wellness,
    hydration: { totalMl: 750, goalMl: 3000, entries: [] },
    readiness: calculateReadiness(wellness),
    recovery: { modalities: [], score: null },
    sessions: [
      {
        id: "session_demo_am",
        slot: "morning",
        time: "7:00 AM",
        title: "Conditioning",
        detail: "Tempo runs · 40 min",
        status: "planned",
        plannedDurationMinutes: 40,
      },
      {
        id: "session_demo_pm",
        slot: "evening",
        time: "5:30 PM",
        title: "Strength",
        detail: "Lower body · 4 × 8",
        status: "planned",
        plannedDurationMinutes: 55,
      },
    ],
  };
}

function buildHistoricalSessions(dateKey: string, index: number): DemoSession[] {
  const deload = dateKey === "2026-07-05";
  const partial = dateKey === "2026-06-29";
  const effort = deload ? 5 : Math.min(8, 6 + Math.floor(index / 12));
  const sprintDuration = deload ? 28 : 38 + (index % 4);
  const strengthDuration = deload ? 35 : 48 + (index % 5);
  const sprint: DemoSession = {
    id: `session_${dateKey}_am`,
    slot: "morning",
    time: "7:00 AM",
    title: index % 2 === 0 ? "Sprint mechanics" : "Speed endurance",
    detail: deload ? "Deload accelerations" : "Acceleration and tempo work",
    status: "completed",
    plannedDurationMinutes: deload ? 30 : 40,
    actualDurationMinutes: sprintDuration,
    effortRating: effort,
    distanceMeters: deload ? 600 : 900 + (index % 3) * 100,
  };
  sprint.sessionLoad = calculateSessionLoad(sprint);

  const strength: DemoSession = {
    id: `session_${dateKey}_pm`,
    slot: "evening",
    time: "5:30 PM",
    title: deload ? "Strongman deload" : "Strength conditioning",
    detail: deload ? "Reduced volume and load" : "Lower-body strength and carries",
    status: partial ? "partial" : "completed",
    plannedDurationMinutes: deload ? 40 : 55,
    actualDurationMinutes: partial ? 29 : strengthDuration,
    effortRating: partial ? 8 : effort,
    sets: partial ? 3 : deload ? 3 : 4,
    reps: partial ? 5 : deload ? 6 : 8,
    loadKg: deload ? 36 : 40 + Math.floor(index / 7) * 4,
  };
  strength.sessionLoad = calculateSessionLoad(strength);
  return [sprint, strength];
}

function benchmarkForDate(dateKey: string): DemoPerformanceBenchmarks | undefined {
  const values: Record<string, DemoPerformanceBenchmarks> = {
    "2026-06-13": { sprint30m: 4.32, sprint100m: 11.82, verticalJump: 52, farmersWalk40m: 31.5 },
    "2026-06-20": { sprint30m: 4.29, sprint100m: 11.76, verticalJump: 53, farmersWalk40m: 30.7 },
    "2026-06-27": { sprint30m: 4.27, sprint100m: 11.71, verticalJump: 54, farmersWalk40m: 30.1 },
    "2026-07-04": { sprint30m: 4.25, sprint100m: 11.67, verticalJump: 55, farmersWalk40m: 29.5 },
    "2026-07-11": { sprint30m: 4.21, sprint100m: 11.61, verticalJump: 56, farmersWalk40m: 28.8 },
  };
  return values[dateKey];
}

function createSeedCoachPlans(): DemoCoachWorkoutPlan[] {
  const weekly = [
    { dateKey: "2026-06-15", carry: 18, tire: 60, sled: 45, title: "Strongman foundation", focus: "Movement quality" },
    { dateKey: "2026-06-22", carry: 20, tire: 70, sled: 50, title: "Strongman build", focus: "Controlled loading" },
    { dateKey: "2026-06-29", carry: 22, tire: 75, sled: 55, title: "Strongman progression", focus: "Work capacity" },
    { dateKey: "2026-07-06", carry: 16, tire: 55, sled: 40, title: "Strongman deload", focus: "Recovery and technique" },
    { dateKey: "2026-07-13", carry: 24, tire: 80, sled: 60, title: "Strongman conditioning", focus: "Power endurance" },
  ];
  return weekly.map((item, index) => ({
    id: `coach_plan_${item.dateKey}_v1`,
    familyId: `coach_plan_${item.dateKey}`,
    dateKey: item.dateKey,
    slot: "morning",
    title: item.title,
    focus: item.focus,
    version: 1,
    status: "published",
    durationMinutes: item.dateKey === "2026-07-06" ? 45 : 65,
    exercises: [
      {
        id: `exercise_${item.dateKey}_farmers_walk`,
        name: "Farmer’s walk",
        sets: item.dateKey === "2026-07-06" ? 3 : 4,
        distanceMeters: 30,
        loadKg: item.carry,
        loadLabel: "per hand",
        targetRpe: item.dateKey === "2026-07-06" ? 5 : 7,
        restSeconds: 90,
        notes: "Tall posture and fast, controlled steps.",
      },
      {
        id: `exercise_${item.dateKey}_tire_flip`,
        name: "Tire flip",
        sets: item.dateKey === "2026-07-06" ? 3 : 5,
        reps: item.dateKey === "2026-07-06" ? 4 : 6,
        loadKg: item.tire,
        targetRpe: item.dateKey === "2026-07-06" ? 6 : 8,
        restSeconds: 120,
        notes: "Drive through the legs; reset position each repetition.",
      },
      {
        id: `exercise_${item.dateKey}_sled_push`,
        name: "Sled push",
        sets: item.dateKey === "2026-07-06" ? 4 : 6,
        distanceMeters: 20,
        loadKg: item.sled,
        targetRpe: item.dateKey === "2026-07-06" ? 5 : 7,
        restSeconds: 90,
        notes: "Keep the trunk stable and finish each distance with consistent speed.",
      },
    ],
    createdAt: `${item.dateKey}T06:00:00+05:30`,
    updatedAt: `${item.dateKey}T06:00:00+05:30`,
    publishedAt: `${item.dateKey}T06:00:00+05:30`,
  }));
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
