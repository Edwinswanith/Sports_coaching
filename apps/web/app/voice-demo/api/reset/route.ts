import { NextResponse } from "next/server";
import { resetStoredDemoState } from "../../../../lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(
      { ok: true, state: await resetStoredDemoState() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "demo_reset_failed", message: "The local demo could not be reset." },
      { status: 500 },
    );
  }
}
