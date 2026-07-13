import { NextResponse } from "next/server";
import { confirmStoredAssistantPlan, DemoAssistantStoreError } from "@/lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { planId: string } }) {
  try {
    return NextResponse.json(
      { ok: true, turn: await confirmStoredAssistantPlan(params.planId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DemoAssistantStoreError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: "assistant_confirmation_failed", message: "The assistant plan could not be confirmed." },
      { status: 500 },
    );
  }
}
