import { NextResponse } from "next/server";
import { AssistantInterpreterError, interpretAssistantMessage } from "@/lib/voice-demo/assistantInterpreter";
import { readDemoState, resolveAndStoreAssistantTurn } from "@/lib/voice-demo/store";
import { sanitizeAssistantContext } from "@/lib/voice-demo/assistantContext";
import { humanizeAnalyticsTurn } from "@/lib/voice-demo/assistantHumanizer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: unknown; context?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 500) {
      return NextResponse.json(
        { ok: false, error: "invalid_message", message: "Enter a message between 1 and 500 characters." },
        { status: 400 },
      );
    }
    const state = await readDemoState();
    const context = sanitizeAssistantContext(body.context, state);
    const interpretation = await interpretAssistantMessage(message, state, context);
    const resolved = await resolveAndStoreAssistantTurn(interpretation, context);
    const turn = await humanizeAnalyticsTurn(resolved, message);
    return NextResponse.json(
      { ok: true, turn },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AssistantInterpreterError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { ok: false, error: "assistant_turn_failed", message: "The assistant could not interpret that request." },
      { status: 500 },
    );
  }
}
