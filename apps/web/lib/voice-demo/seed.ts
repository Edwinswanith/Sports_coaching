import type { DemoState } from "./types";

export function createSeedDemoState(): DemoState {
  return {
    version: 1,
    athlete: {
      id: "athlete_demo_aarav",
      name: "Aarav Sharma",
      initials: "AS",
      sport: "Sprinter",
      squad: "Development squad",
      timezone: "Asia/Kolkata",
      dateKey: "2026-07-12",
    },
    wellness: {
      sleepQuality: null,
      mood: 7,
      soreness: null,
      fatigue: null,
    },
    hydration: {
      totalMl: 750,
      goalMl: 3000,
      entries: [],
    },
    sessions: [
      {
        id: "session_demo_am",
        slot: "morning",
        time: "7:00 AM",
        title: "Conditioning",
        detail: "Tempo runs · 40 min",
        status: "planned",
      },
      {
        id: "session_demo_pm",
        slot: "evening",
        time: "5:30 PM",
        title: "Strength",
        detail: "Lower body · 4 × 8",
        status: "planned",
      },
    ],
    recovery: { modalities: [] },
    coach: {
      id: "coach_demo_priya",
      name: "Coach Priya",
      latestGuidance:
        "Focus on clean form today. Keep the final two reps controlled in this evening’s strength session.",
      messages: [
        {
          id: "message_demo_coach_1",
          sender: "coach",
          body:
            "Focus on clean form today. Keep the final two reps controlled in this evening’s strength session.",
          createdAt: "2026-07-12T08:05:00+05:30",
        },
      ],
    },
    activity: [],
    operations: [],
    assistantPlans: [],
    updatedAt: "2026-07-12T08:20:00+05:30",
  };
}
