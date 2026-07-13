import type { AssistantConversationContext, AssistantTurnResponse, DemoApiResponse, DemoCoachWorkoutPlan, DemoState, DemoToolCall, DemoToolResult } from "./types";

export async function getDemoState(): Promise<DemoState> {
  const response = await fetch("/voice-demo/api/state", { cache: "no-store" });
  const body = (await response.json()) as DemoApiResponse;
  if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to load the demo." : body.message);
  return body.state;
}

export async function executeDemoAction(call: DemoToolCall): Promise<{ state: DemoState; result: DemoToolResult }> {
  const response = await fetch("/voice-demo/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(call),
  });
  const body = (await response.json()) as DemoApiResponse;
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.ok ? "The demo action did not return a result." : body.message);
  }
  return { state: body.state, result: body.result };
}

export async function resetDemoState(): Promise<DemoState> {
  const response = await fetch("/voice-demo/api/reset", { method: "POST" });
  const body = (await response.json()) as DemoApiResponse;
  if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to reset the demo." : body.message);
  return body.state;
}

export function newOperationId() {
  return `manual_${crypto.randomUUID()}`;
}

export async function submitAssistantMessage(message: string, context: AssistantConversationContext = {}): Promise<AssistantTurnResponse> {
  return assistantRequest("/voice-demo/api/assistant/turn", { message, context });
}

export async function transcribeVoiceDemoAudio(audio: Blob): Promise<string> {
  const formData = new FormData();
  const extension = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
  formData.append("audio", audio, `voice-demo-command.${extension}`);
  const response = await fetch("/voice-demo/api/transcribe", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as
    | { ok: true; transcript: string }
    | { ok: false; error: string; message: string };
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? "Voice transcription failed." : payload.message);
  return payload.transcript;
}

export async function getCoachPlans(): Promise<{ state: DemoState; plans: DemoCoachWorkoutPlan[] }> {
  const response = await fetch("/voice-demo/api/coach-plans", { cache: "no-store" });
  const payload = await response.json() as { ok: true; state: DemoState; plans: DemoCoachWorkoutPlan[] } | { ok: false; message: string };
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? "Unable to load coach plans." : payload.message);
  return { state: payload.state, plans: payload.plans };
}

export async function createCoachPlanDraft(input: unknown): Promise<{ state: DemoState; plan: DemoCoachWorkoutPlan }> {
  return coachPlanRequest("/voice-demo/api/coach-plans", "POST", input);
}

export async function updateCoachPlanDraft(planId: string, patch: unknown): Promise<{ state: DemoState; plan: DemoCoachWorkoutPlan }> {
  return coachPlanRequest(`/voice-demo/api/coach-plans/${encodeURIComponent(planId)}`, "PATCH", patch);
}

export async function publishCoachPlan(planId: string): Promise<{ state: DemoState; plan: DemoCoachWorkoutPlan }> {
  return coachPlanRequest(`/voice-demo/api/coach-plans/${encodeURIComponent(planId)}/publish`, "POST");
}

export async function confirmAssistantPlan(planId: string): Promise<AssistantTurnResponse> {
  return assistantRequest(`/voice-demo/api/assistant/plans/${encodeURIComponent(planId)}/confirm`);
}

export async function cancelAssistantPlan(planId: string): Promise<AssistantTurnResponse> {
  return assistantRequest(`/voice-demo/api/assistant/plans/${encodeURIComponent(planId)}/cancel`);
}

async function assistantRequest(url: string, body?: unknown): Promise<AssistantTurnResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as
    | { ok: true; turn: AssistantTurnResponse }
    | { ok: false; error: string; message: string };
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? "The assistant request failed." : payload.message);
  return payload.turn;
}

async function coachPlanRequest(url: string, method: "POST" | "PATCH", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as
    | { ok: true; state: DemoState; plan: DemoCoachWorkoutPlan }
    | { ok: false; error: string; message: string };
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? "The coach plan request failed." : payload.message);
  return { state: payload.state, plan: payload.plan };
}
