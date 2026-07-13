"use client";

import { useEffect, useMemo, useState } from "react";
import { createCoachPlanDraft, publishCoachPlan, updateCoachPlanDraft } from "../../lib/voice-demo/client";
import { formatPlanDate, getPublishedCoachPlan } from "../../lib/voice-demo/analytics";
import type { DemoCoachExercise, DemoCoachWorkoutPlan, DemoState } from "../../lib/voice-demo/types";

const PLAN_DATE = "2026-07-13";

export function CoachPlanner({ state, onStateChange }: { state: DemoState; onStateChange: (state: DemoState) => void }) {
  const published = getPublishedCoachPlan(state, PLAN_DATE);
  const draft = useMemo(
    () => state.coachPlans.find((plan) => plan.status === "draft" && plan.familyId === published?.familyId) ?? null,
    [state.coachPlans, published?.familyId],
  );
  const [working, setWorking] = useState<DemoCoachWorkoutPlan | null>(draft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => setWorking(draft), [draft]);

  async function createRevision() {
    if (!published || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await createCoachPlanDraft({ basedOnPlanId: published.id });
      onStateChange(outcome.state);
      setWorking(outcome.plan);
      setMessage({ tone: "ok", text: "Draft revision created. Athletes still see the published version." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The draft could not be created." });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!working || busy) return null;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await updateCoachPlanDraft(working.id, editableFields(working));
      onStateChange(outcome.state);
      setWorking(outcome.plan);
      setMessage({ tone: "ok", text: "Draft saved. The athlete-facing published plan is unchanged." });
      return outcome;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The draft could not be saved." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publishDraft() {
    if (!working || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateCoachPlanDraft(working.id, editableFields(working));
      const outcome = await publishCoachPlan(saved.plan.id);
      onStateChange(outcome.state);
      setWorking(null);
      setMessage({ tone: "ok", text: `Version ${outcome.plan.version} published. The athlete dashboard and assistant now use it.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The plan could not be published." });
    } finally {
      setBusy(false);
    }
  }

  if (!published) return <div className="rounded-3xl border border-line bg-white p-6">No published plan is available.</div>;

  return (
    <div className="space-y-5" data-testid="coach-planner">
      <section className="rounded-[2rem] bg-[#173e34] p-6 text-white shadow-hero">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8ad8b7]">Coach Priya · plan authority</p>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-[-0.04em]">Draft privately. Publish deliberately.</h2>
            <p className="mt-2 max-w-xl text-sm text-white/60">Aarav sees only the latest published version. Exercise volume and intensity remain coach-authored.</p>
          </div>
          <button type="button" onClick={createRevision} disabled={busy || Boolean(draft)} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#173e34] disabled:opacity-45">
            {draft ? "Revision in progress" : "Create revision"}
          </button>
        </div>
      </section>

      {message ? (
        <div role="status" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${message.tone === "ok" ? "border-ok/20 bg-ok/[0.07] text-ok" : "border-bad/20 bg-bad/[0.06] text-bad"}`}>
          {message.text}
        </div>
      ) : null}

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised" data-testid="published-plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ok">Athlete-visible · published</p>
            <h3 className="mt-1 text-xl font-bold text-ink">{published.title}</h3>
            <p className="mt-1 text-xs text-ink-muted">{formatPlanDate(published.dateKey)} · {published.focus} · {published.durationMinutes} min</p>
          </div>
          <span className="rounded-full bg-ok/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ok">Version {published.version}</span>
        </div>
        <ExercisePreview exercises={published.exercises} />
        {draft ? <p className="mt-4 rounded-2xl border border-accent/15 bg-accent/[0.05] p-3 text-xs text-ink-muted">A private revision is being edited. Aarav continues to see version {published.version} until Publish is selected.</p> : null}
      </section>

      {working ? (
        <section className="rounded-[1.6rem] border border-accent/25 bg-white p-5 shadow-raised" data-testid="draft-plan-editor">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">Private draft revision</p>
              <h3 className="mt-1 text-xl font-bold text-ink">Edit the next published version</h3>
            </div>
            <span className="rounded-full bg-warn/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-warn">Not athlete-visible</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <TextField label="Workout title" value={working.title} onChange={(title) => setWorking({ ...working, title })} />
            <TextField label="Focus" value={working.focus} onChange={(focus) => setWorking({ ...working, focus })} />
            <NumberInput label="Duration (minutes)" value={working.durationMinutes} min={1} max={240} onChange={(durationMinutes) => setWorking({ ...working, durationMinutes })} />
            <label className="space-y-1.5 text-xs font-semibold text-ink-muted"><span>Slot</span><select aria-label="Workout slot" value={working.slot} onChange={(event) => setWorking({ ...working, slot: event.target.value as DemoCoachWorkoutPlan["slot"] })} className="field"><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></label>
          </div>

          <div className="mt-5 space-y-3">
            {working.exercises.map((exercise, index) => (
              <ExerciseEditor key={exercise.id} exercise={exercise} onChange={(next) => setWorking({ ...working, exercises: working.exercises.map((item, itemIndex) => itemIndex === index ? next : item) })} />
            ))}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void saveDraft()} disabled={busy} className="btn-secondary">{busy ? "Saving…" : "Save draft"}</button>
            <button type="button" onClick={() => void publishDraft()} disabled={busy} className="btn-primary">{busy ? "Validating…" : "Validate and publish"}</button>
          </div>
          <p className="mt-3 text-center text-[10px] text-ink-faint">Publishing rejects invalid sets, reps, distance, load, target RPE, rest, or duration with a field-specific message.</p>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <BoundaryCard number="01" title="Coach authors" detail="Loads, volume, rest and target RPE begin in this planner." />
        <BoundaryCard number="02" title="Athlete reviews" detail="Only a published plan appears on the athlete dashboard and in assistant answers." />
        <BoundaryCard number="03" title="Assistant explains" detail="The assistant can report evidence, but cannot independently increase intensity." />
      </section>
    </div>
  );
}

function ExercisePreview({ exercises }: { exercises: DemoCoachExercise[] }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {exercises.map((exercise) => (
        <article key={exercise.id} className="rounded-2xl border border-line bg-[#fafbf9] p-4">
          <p className="font-bold text-ink">{exercise.name}</p>
          <p className="mt-2 text-sm font-semibold text-ink">{exercise.reps !== undefined ? `${exercise.sets} × ${exercise.reps} reps` : `${exercise.sets} × ${exercise.distanceMeters} m`}</p>
          <p className="mt-1 text-xs text-ink-muted">{exercise.loadKg} kg{exercise.loadLabel ? ` ${exercise.loadLabel}` : ""} · RPE {exercise.targetRpe}</p>
          <p className="mt-1 text-[10px] text-ink-faint">{exercise.restSeconds}s rest</p>
        </article>
      ))}
    </div>
  );
}

function ExerciseEditor({ exercise, onChange }: { exercise: DemoCoachExercise; onChange: (exercise: DemoCoachExercise) => void }) {
  const update = <K extends keyof DemoCoachExercise,>(key: K, value: DemoCoachExercise[K]) => onChange({ ...exercise, [key]: value });
  return (
    <fieldset className="rounded-2xl border border-line bg-[#fafbf9] p-4">
      <legend className="px-2 text-sm font-bold text-ink">{exercise.name}</legend>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumberInput label="Sets" value={exercise.sets} min={1} max={20} onChange={(value) => update("sets", value)} />
        {exercise.reps !== undefined ? <NumberInput label="Reps" value={exercise.reps} min={1} max={100} onChange={(value) => update("reps", value)} /> : <NumberInput label="Distance m" value={exercise.distanceMeters ?? 0} min={1} max={200} onChange={(value) => update("distanceMeters", value)} />}
        <NumberInput label="Load kg" value={exercise.loadKg} min={0} max={300} onChange={(value) => update("loadKg", value)} />
        <NumberInput label="Target RPE" value={exercise.targetRpe} min={1} max={10} onChange={(value) => update("targetRpe", value)} />
        <NumberInput label="Rest sec" value={exercise.restSeconds} min={0} max={600} onChange={(value) => update("restSeconds", value)} />
        <TextField label="Notes" value={exercise.notes ?? ""} onChange={(value) => update("notes", value)} />
      </div>
    </fieldset>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1.5 text-xs font-semibold text-ink-muted"><span>{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="field" /></label>;
}

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="space-y-1.5 text-xs font-semibold text-ink-muted"><span>{label}</span><input aria-label={label} type="number" value={value} min={min} max={max} step="1" onChange={(event) => onChange(Number(event.target.value))} className="field nums" /></label>;
}

function BoundaryCard({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <article className="rounded-2xl border border-line bg-white p-4 shadow-raised"><p className="nums text-xs font-bold text-accent-strong">{number}</p><h3 className="mt-3 text-sm font-bold text-ink">{title}</h3><p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p></article>;
}

function editableFields(plan: DemoCoachWorkoutPlan) {
  return {
    dateKey: plan.dateKey,
    slot: plan.slot,
    title: plan.title,
    focus: plan.focus,
    durationMinutes: plan.durationMinutes,
    exercises: plan.exercises,
  };
}
