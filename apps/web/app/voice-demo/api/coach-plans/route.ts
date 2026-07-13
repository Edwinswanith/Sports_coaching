import { NextResponse } from "next/server";
import { CoachPlanError, type CoachPlanDraftInput } from "@/lib/voice-demo/coachPlans";
import { createStoredCoachPlanDraft, listStoredCoachPlans } from "@/lib/voice-demo/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { state, plans } = await listStoredCoachPlans();
    const latestPublishedByFamily = new Map<string, number>();
    for (const plan of plans.filter((candidate) => candidate.status === "published")) {
      latestPublishedByFamily.set(plan.familyId, Math.max(latestPublishedByFamily.get(plan.familyId) ?? 0, plan.version));
    }
    const visiblePlans = plans.map((plan) => ({
      ...plan,
      athleteVisible: plan.status === "published" && latestPublishedByFamily.get(plan.familyId) === plan.version,
    }));
    return NextResponse.json({ ok: true, state, plans: visiblePlans }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "coach_plans_unavailable", message: "Coach plans could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as CoachPlanDraftInput;
    const outcome = await createStoredCoachPlanDraft(input);
    return NextResponse.json({ ok: true, ...outcome }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CoachPlanError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "coach_plan_create_failed", message: "The coach plan draft could not be created." }, { status: 500 });
  }
}
