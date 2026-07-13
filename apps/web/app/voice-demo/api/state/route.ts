import { NextResponse } from "next/server";
import { readDemoState } from "../../../../lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, state: await readDemoState() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: "demo_state_unavailable", message: "The local demo state could not be loaded." },
      { status: 500 },
    );
  }
}
