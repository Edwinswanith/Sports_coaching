export const DEMO_SCHEMA_VERSION = 2 as const;

export type WellnessKey = "sleepQuality" | "mood" | "soreness" | "fatigue";
export type SessionStatus = "planned" | "completed" | "partial" | "skipped";
export type RecoveryModality = "Stretching" | "Mobility" | "Ice bath" | "Physio";
export type PerformanceMetric = "sprint30m" | "sprint100m" | "verticalJump" | "farmersWalk40m";
export type ProgressRangeDays = 7 | 14 | 30;

export type DemoWellness = Record<WellnessKey, number | null> & {
  sleepHours: number | null;
};

export type DemoSession = {
  id: string;
  slot: "morning" | "afternoon" | "evening";
  time: string;
  title: string;
  detail: string;
  status: SessionStatus;
  plannedDurationMinutes?: number;
  actualDurationMinutes?: number;
  effortRating?: number;
  sets?: number;
  reps?: number;
  distanceMeters?: number;
  loadKg?: number;
  sessionLoad?: number;
};

export type DemoPerformanceBenchmarks = Partial<Record<PerformanceMetric, number>>;

export type DemoDay = {
  dateKey: string;
  wellness: DemoWellness;
  hydration: {
    totalMl: number;
    goalMl: number;
    entries: Array<{ id: string; amountMl: number; operationId: string; createdAt: string }>;
  };
  readiness: number | null;
  recovery: { modalities: RecoveryModality[]; score: number | null };
  sessions: DemoSession[];
  benchmarks?: DemoPerformanceBenchmarks;
  note?: string;
};

export type DemoCoachExercise = {
  id: string;
  name: string;
  sets: number;
  reps?: number;
  distanceMeters?: number;
  loadKg: number;
  loadLabel?: string;
  targetRpe: number;
  restSeconds: number;
  notes?: string;
};

export type DemoCoachWorkoutPlan = {
  id: string;
  familyId: string;
  dateKey: string;
  slot: "morning" | "afternoon" | "evening";
  title: string;
  focus: string;
  version: number;
  status: "draft" | "published";
  durationMinutes: number;
  exercises: DemoCoachExercise[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  basedOnPlanId?: string;
};

export type DemoMessage = {
  id: string;
  sender: "athlete" | "coach";
  body: string;
  createdAt: string;
  operationId?: string;
};

export type DemoActivity = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
};

export type DemoOperation = {
  id: string;
  tool: DemoToolCall["tool"];
  result: DemoToolResult;
  createdAt: string;
};

export type DemoAssistantPlan = {
  id: string;
  status: "proposed" | "completed" | "cancelled";
  summary: string;
  displayFields: Array<{ label: string; value: string }>;
  toolCall: DemoToolCall;
  createdAt: string;
  expiresAt: string;
  result?: DemoToolResult;
  completedAt?: string;
  cancelledAt?: string;
};

export type DemoState = {
  schemaVersion: typeof DEMO_SCHEMA_VERSION;
  revision: number;
  athlete: {
    id: "athlete_demo_aarav";
    name: "Aarav Sharma";
    initials: "AS";
    sport: "Sprinter";
    squad: "Development squad";
    timezone: "Asia/Kolkata";
    dateKey: "2026-07-12";
  };
  days: DemoDay[];
  coach: {
    id: "coach_demo_priya";
    name: "Coach Priya";
    latestGuidance: string;
    messages: DemoMessage[];
  };
  coachPlans: DemoCoachWorkoutPlan[];
  activity: DemoActivity[];
  operations: DemoOperation[];
  assistantPlans: DemoAssistantPlan[];
  updatedAt: string;
};

export type DemoToolCall =
  | { operationId: string; tool: "add_water"; arguments: { amountMl: number } }
  | {
      operationId: string;
      tool: "record_wellness";
      arguments: Partial<Record<WellnessKey, number>> & { sleepHours?: number };
    }
  | {
      operationId: string;
      tool: "update_training_session";
      arguments: {
        sessionId: string;
        status: Exclude<SessionStatus, "planned">;
        sets?: number;
        reps?: number;
        effort?: number;
        actualDurationMinutes?: number;
      };
    }
  | {
      operationId: string;
      tool: "record_recovery";
      arguments: { modalities: RecoveryModality[] };
    }
  | {
      operationId: string;
      tool: "send_coach_message";
      arguments: { coachId: string; body: string };
    };

export type DemoToolResult = {
  operationId: string;
  tool: DemoToolCall["tool"];
  message: string;
  changed: boolean;
};

export type AssistantTopic =
  | "daily_status"
  | "progress"
  | "period_comparison"
  | "best_day"
  | "day_details"
  | "coach_message"
  | "coach_plan"
  | "exercise"
  | "intensity";

export type AssistantConversationContext = {
  topic?: AssistantTopic;
  rangeDays?: ProgressRangeDays;
  rangeStart?: string;
  rangeEnd?: string;
  metric?: PerformanceMetric | "readiness" | "trainingCompletion";
  dateKey?: string;
  planId?: string;
  exerciseId?: string;
};

export type AssistantEvidence = { label: string; value: string; dateKey?: string };

export type AssistantDebug = {
  provider: "deterministic" | "gemini";
  model?: string;
  latencyMs: number;
  candidateTools: string[];
  normalizedQuery?: string;
  dateRange?: { start: string; end: string };
  metric?: string;
  context?: AssistantConversationContext;
  evidence?: AssistantEvidence[];
  safetyDecision?: string;
};

type AssistantReplyBase = {
  message: string;
  evidence?: AssistantEvidence[];
  suggestions?: string[];
  context: AssistantConversationContext;
  debug: AssistantDebug;
};

export type AssistantTurnResponse =
  | ({ kind: "answer" } & AssistantReplyBase)
  | ({ kind: "clarification"; options?: string[] } & AssistantReplyBase)
  | ({ kind: "unsupported" } & AssistantReplyBase)
  | ({
      kind: "plan";
      plan: Pick<DemoAssistantPlan, "id" | "summary" | "displayFields" | "expiresAt"> & {
        tool: DemoToolCall["tool"];
      };
    } & AssistantReplyBase)
  | {
      kind: "completed";
      message: string;
      planId: string;
      result: DemoToolResult;
      state: DemoState;
      context: AssistantConversationContext;
      debug?: AssistantDebug;
    }
  | { kind: "cancelled"; message: string; planId: string; context: AssistantConversationContext };

export type DemoApiResponse =
  | { ok: true; state: DemoState; result?: DemoToolResult }
  | { ok: false; error: string; message: string };

export function getActiveDemoDay(state: DemoState): DemoDay {
  const day = state.days.find((candidate) => candidate.dateKey === state.athlete.dateKey);
  if (!day) throw new Error(`Demo day ${state.athlete.dateKey} is missing.`);
  return day;
}
