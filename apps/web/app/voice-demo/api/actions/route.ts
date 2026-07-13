import { NextResponse } from "next/server";
import { DemoToolError } from "../../../../lib/voice-demo/tools";
import { runStoredDemoTool } from "../../../../lib/voice-demo/store";
import type { DemoToolCall } from "../../../../lib/voice-demo/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const call = (await request.json()) as DemoToolCall;
    if (!call || typeof call !== "object" || typeof call.tool !== "string" || typeof call.operationId !== "string") {
      throw new DemoToolError("invalid_action", "The demo action is malformed.");
    }
    const { state, result } = await runStoredDemoTool(call);
    return NextResponse.json({ ok: true, state, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DemoToolError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: "demo_action_failed", message: "The local demo action could not be completed." },
      { status: 500 },
    );
  }
}
