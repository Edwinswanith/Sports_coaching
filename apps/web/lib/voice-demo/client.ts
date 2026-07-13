import type { AssistantTurnResponse, DemoApiResponse, DemoState, DemoToolCall, DemoToolResult } from "./types";

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

export async function submitAssistantMessage(message: string): Promise<AssistantTurnResponse> {
  return assistantRequest("/voice-demo/api/assistant/turn", { message });
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
