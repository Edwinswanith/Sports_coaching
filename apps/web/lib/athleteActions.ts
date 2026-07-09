import { apiFetch } from "./api";
import type { SessionSlot } from "./sessions";

/**
 * Single source of truth for the athlete-scoped write endpoints — every
 * payload shape here must exactly match server/src/routes/athlete.ts.
 * Used by both the manual dashboard forms and the voice assistant so the
 * two paths can never diverge in what they send to the API.
 */

export function wellnessTenToFive(raw: number | string): number {
  const value = Math.max(1, Math.min(10, Number(raw) || 5));
  return 1 + ((value - 1) * 4) / 9;
}

export function wellnessFiveToTen(value: number | null | undefined): number {
  if (value === null || value === undefined) return 5;
  return Math.max(1, Math.min(10, Math.round(1 + ((value - 1) * 9) / 4)));
}

export type WellnessCheckInInput = {
  date: string;
  sleepHours?: number;
  /** Spoken/UI 1-10 scale — converted to the backend's 1-5 scale here. */
  sleepQuality: number | string;
  mood: number | string;
  stress: number | string;
  soreness: number | string;
  fatigue: number | string;
};

export function submitWellnessAction(input: WellnessCheckInInput): Promise<Response> {
  return apiFetch("/api/athlete/wellness", {
    method: "POST",
    body: JSON.stringify({
      date: input.date,
      sleepHours: input.sleepHours,
      sleepQuality: wellnessTenToFive(input.sleepQuality),
      mood: wellnessTenToFive(input.mood),
      stress: wellnessTenToFive(input.stress),
      soreness: wellnessTenToFive(input.soreness),
      fatigue: wellnessTenToFive(input.fatigue),
    }),
  });
}

export function submitHeartRateAction(date: string, payload: { wakeHr?: number; bedHr?: number }): Promise<Response> {
  return apiFetch("/api/athlete/heart-rate", { method: "POST", body: JSON.stringify({ date, ...payload }) });
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "rest";

export function submitAttendanceAction(date: string, status: AttendanceStatus): Promise<Response> {
  return apiFetch("/api/athlete/attendance", { method: "POST", body: JSON.stringify({ date, status }) });
}

export function submitRestDayAction(date: string, enabled: boolean): Promise<Response> {
  return apiFetch("/api/athlete/rest-day", { method: "POST", body: JSON.stringify({ date, enabled }) });
}

export type TrainingSessionInput = {
  status?: "planned" | "in_progress" | "completed" | "skipped" | "rest";
  attended?: boolean;
  workoutType?: string;
  sets?: number;
  reps?: string;
  actualDurationMin?: number;
  effortRating?: number;
  notes?: string;
};

export function submitTrainingAction(date: string, slot: SessionSlot, input: TrainingSessionInput): Promise<Response> {
  return apiFetch(`/api/athlete/training/${slot}`, { method: "POST", body: JSON.stringify({ date, ...input }) });
}

export type RpeMonitoringInput = {
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  sleepQuality: number;
  muscleSoreness: number;
  fatigue: number;
  moodMotivation: number;
  restingHeartRate?: number;
  bodyConditionFeedback?: string;
};

export function submitRpeMonitoringAction(date: string, input: RpeMonitoringInput): Promise<Response> {
  return apiFetch("/api/athlete/rpe-monitoring", { method: "POST", body: JSON.stringify({ date, ...input }) });
}

export const RECOVERY_MODALITIES = ["stretching", "ice_bath", "mobility", "physio", "hydration"] as const;

export function submitRecoveryAction(date: string, modalities: string[]): Promise<Response> {
  return apiFetch("/api/athlete/recovery", { method: "POST", body: JSON.stringify({ date, modalities }) });
}

export function addWaterAction(date: string, amountMl: number): Promise<Response> {
  return apiFetch("/api/athlete/water", { method: "POST", body: JSON.stringify({ date, amountMl }) });
}

export function removeWaterAction(id: string): Promise<Response> {
  return apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" });
}

export function saveHydrationGoalAction(hydrationGoalMl: number): Promise<Response> {
  return apiFetch("/api/athlete/me", { method: "PATCH", body: JSON.stringify({ hydrationGoalMl }) });
}

export function sendCoachMessageAction(coachId: string, body: string): Promise<Response> {
  return apiFetch(`/api/athlete/messages/${coachId}`, { method: "POST", body: JSON.stringify({ body }) });
}
