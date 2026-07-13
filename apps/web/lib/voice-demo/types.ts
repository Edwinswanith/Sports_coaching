export type WellnessKey = "sleepQuality" | "mood" | "soreness" | "fatigue";
export type SessionStatus = "planned" | "completed" | "partial" | "skipped";
export type RecoveryModality = "Stretching" | "Mobility" | "Ice bath" | "Physio";

export type DemoSession = {
  id: string;
  slot: "morning" | "evening";
  time: string;
  title: string;
  detail: string;
  status: SessionStatus;
  sets?: number;
  reps?: number;
  effort?: number;
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
  version: number;
  athlete: {
    id: "athlete_demo_aarav";
    name: "Aarav Sharma";
    initials: "AS";
    sport: "Sprinter";
    squad: "Development squad";
    timezone: "Asia/Kolkata";
    dateKey: "2026-07-12";
  };
  wellness: Record<WellnessKey, number | null>;
  hydration: {
    totalMl: number;
    goalMl: number;
    entries: Array<{ id: string; amountMl: number; operationId: string; createdAt: string }>;
  };
  sessions: DemoSession[];
  recovery: { modalities: RecoveryModality[] };
  coach: {
    id: "coach_demo_priya";
    name: "Coach Priya";
    latestGuidance: string;
    messages: DemoMessage[];
  };
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
      arguments: Partial<Record<WellnessKey, number>>;
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

export type DemoApiResponse =
  | { ok: true; state: DemoState; result?: DemoToolResult }
  | { ok: false; error: string; message: string };

export type AssistantDebug = {
  provider: "deterministic" | "gemini";
  model?: string;
  latencyMs: number;
  candidateTools: string[];
};

export type AssistantTurnResponse =
  | { kind: "answer"; message: string; debug: AssistantDebug }
  | { kind: "clarification"; message: string; options?: string[]; debug: AssistantDebug }
  | { kind: "unsupported"; message: string; debug: AssistantDebug }
  | {
      kind: "plan";
      message: string;
      plan: Pick<DemoAssistantPlan, "id" | "summary" | "displayFields" | "expiresAt"> & {
        tool: DemoToolCall["tool"];
      };
      debug: AssistantDebug;
    }
  | {
      kind: "completed";
      message: string;
      planId: string;
      result: DemoToolResult;
      state: DemoState;
      debug?: AssistantDebug;
    }
  | { kind: "cancelled"; message: string; planId: string };
