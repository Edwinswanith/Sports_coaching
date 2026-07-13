import { NextResponse } from "next/server";
import { CoachPlanError, type CoachPlanDraftPatch } from "@/lib/voice-demo/coachPlans";
import { editStoredCoachPlanDraft } from "@/lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const patch = await request.json() as CoachPlanDraftPatch;
    const outcome = await editStoredCoachPlanDraft(planId, patch);
    return NextResponse.json({ ok: true, ...outcome }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CoachPlanError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "coach_plan_update_failed", message: "The coach plan draft could not be updated." }, { status: 500 });
  }
}
