import { NextResponse } from "next/server";
import { CoachPlanError } from "@/lib/voice-demo/coachPlans";
import { publishStoredCoachPlanDraft } from "@/lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const outcome = await publishStoredCoachPlanDraft(planId);
    return NextResponse.json({ ok: true, ...outcome }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CoachPlanError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "coach_plan_publish_failed", message: "The coach plan draft could not be published." }, { status: 500 });
  }
}
