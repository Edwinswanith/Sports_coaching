import { NextResponse } from "next/server";
import { cancelStoredAssistantPlan, DemoAssistantStoreError } from "@/lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { planId: string } }) {
  try {
    return NextResponse.json(
      { ok: true, turn: await cancelStoredAssistantPlan(params.planId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DemoAssistantStoreError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: "assistant_cancel_failed", message: "The assistant plan could not be cancelled." },
      { status: 500 },
    );
  }
}
