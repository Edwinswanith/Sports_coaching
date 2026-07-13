"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  PERFORMANCE_METRICS,
  formatBenchmarkDelta,
  formatDate,
  getDaysForRange,
  getProgressSummary,
} from "../../lib/voice-demo/analytics";
import type { DemoDay, DemoState, ProgressRangeDays } from "../../lib/voice-demo/types";

export function ProgressView({ state }: { state: DemoState }) {
  const [rangeDays, setRangeDays] = useState<ProgressRangeDays>(30);
  const [selectedDay, setSelectedDay] = useState<DemoDay | null>(null);
  const summary = useMemo(() => getProgressSummary(state, rangeDays), [state, rangeDays]);
  const days = useMemo(() => getDaysForRange(state, rangeDays), [state, rangeDays]);
  const chartData = days.map((day) => ({
    date: day.dateKey.slice(5),
    dateKey: day.dateKey,
    readiness: day.readiness,
    hydration: Math.round((day.hydration.totalMl / day.hydration.goalMl) * 100),
    load: day.sessions.reduce((total, session) => total + (session.sessionLoad ?? 0), 0),
  }));

  return (
    <div className="space-y-5" data-testid="progress-view">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#15382e] p-6 text-white shadow-hero">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[42px] border-white/[0.04]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8ad8b7]">Evidence, not guesswork</p>
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.04em]">Aarav is trending forward.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
              {formatDate(summary.startDate)} to {formatDate(summary.endDate)} · benchmarks, readiness, completion, hydration and calculated training load.
            </p>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-white/[0.06] p-1" aria-label="Progress period">
            {([7, 14, 30] as ProgressRangeDays[]).map((range) => (
              <button
                type="button"
                key={range}
                onClick={() => setRangeDays(range)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${rangeDays === range ? "bg-white text-[#15382e]" : "text-white/60 hover:text-white"}`}
                aria-pressed={rangeDays === range}
              >
                {range} days
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Average readiness" value={summary.stats.averageReadiness === null ? "—" : `${summary.stats.averageReadiness.toFixed(1)}`} suffix="/100" helper="Calculated from recorded wellness" />
        <MetricCard label="Training completion" value={`${summary.stats.trainingCompletionPercent}`} suffix="%" helper={`${summary.stats.recordedDays} days reviewed`} />
        <MetricCard label="Hydration goal" value={`${summary.stats.hydrationGoalPercent}`} suffix="%" helper="Days at or above target" />
        <MetricCard label="Session load" value={summary.stats.totalSessionLoad.toLocaleString("en-IN")} suffix="AU" helper="Duration × effort" />
      </section>

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">Trend lines</p>
            <h3 className="mt-1 text-lg font-bold text-ink">Readiness and hydration consistency</h3>
          </div>
          <span className="rounded-full bg-surface-inset px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">{rangeDays} days</span>
        </div>
        <div className="mt-5 h-72 w-full" aria-label="Readiness and hydration line chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ece8" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#738078" }} minTickGap={22} />
              <YAxis domain={[0, 110]} tick={{ fontSize: 10, fill: "#738078" }} />
              <Tooltip contentStyle={{ borderRadius: 14, borderColor: "#dfe7e2", fontSize: 12 }} />
              <Line type="monotone" dataKey="readiness" name="Readiness" stroke="#0f7656" strokeWidth={3} dot={false} connectNulls />
              <Line type="monotone" dataKey="hydration" name="Hydration %" stroke="#55a8d4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-4 text-[10px] font-semibold text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#0f7656]" /> Readiness</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#55a8d4]" /> Hydration goal %</span>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">Performance benchmarks</p>
          <h3 className="mt-1 text-lg font-bold text-ink">First to latest recorded test</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {summary.benchmarks.length ? summary.benchmarks.map((delta) => (
              <article key={delta.metric} className="rounded-2xl border border-line bg-[#fafbf9] p-4">
                <p className="text-xs font-semibold text-ink-muted">{PERFORMANCE_METRICS[delta.metric].label}</p>
                <p className="nums mt-2 text-lg font-bold text-ink">{formatBenchmarkDelta(delta)}</p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-ok">Improving</p>
              </article>
            )) : <p className="text-sm text-ink-muted">Two benchmark observations are required in this range.</p>}
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">Triggered priorities</p>
          <h3 className="mt-1 text-lg font-bold text-ink">Deterministic review thresholds</h3>
          <div className="mt-4 space-y-2">
            {summary.priorities.map((priority) => (
              <div key={priority} className="flex gap-3 rounded-2xl border border-warn/15 bg-warn/[0.055] p-3.5">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn" />
                <p className="text-xs leading-relaxed text-ink-muted">{priority}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">These are evidence flags. Coach Priya remains the authority for changes to training volume or intensity.</p>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-line bg-white p-5 shadow-raised">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-strong">Daily history</p>
            <h3 className="mt-1 text-lg font-bold text-ink">Open any recorded day</h3>
          </div>
          <span className="text-xs font-semibold text-ink-muted">{days.length} days</span>
        </div>
        <div className="mt-4 max-h-[430px] divide-y divide-line overflow-y-auto rounded-2xl border border-line">
          {[...days].reverse().map((day) => (
            <button key={day.dateKey} type="button" onClick={() => setSelectedDay(day)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 bg-white px-4 py-3 text-left transition hover:bg-surface-inset">
              <span>
                <span className="block text-sm font-bold text-ink">{formatDate(day.dateKey)}</span>
                <span className="mt-0.5 block text-[10px] text-ink-muted">{day.sessions.map((session) => `${session.title}: ${session.status}`).join(" · ")}</span>
              </span>
              <span className="nums text-sm font-bold text-accent-strong">{day.readiness ?? "—"}</span>
              <span className="text-ink-faint">›</span>
            </button>
          ))}
        </div>
      </section>

      {selectedDay ? <DayDetail day={selectedDay} onClose={() => setSelectedDay(null)} /> : null}
    </div>
  );
}

function MetricCard({ label, value, suffix, helper }: { label: string; value: string; suffix: string; helper: string }) {
  return (
    <article className="rounded-[1.4rem] border border-line bg-white p-4 shadow-raised">
      <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink-faint">{label}</p>
      <p className="nums mt-2 text-3xl font-bold tracking-[-0.04em] text-ink">{value} <span className="text-sm font-semibold text-ink-muted">{suffix}</span></p>
      <p className="mt-2 text-[10px] text-ink-muted">{helper}</p>
    </article>
  );
}

function DayDetail({ day, onClose }: { day: DemoDay; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Details for ${day.dateKey}`}>
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close day details" />
      <aside className="relative h-full w-full max-w-md overflow-y-auto rounded-[1.8rem] bg-white p-5 shadow-hero">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-accent-strong">Recorded day</p><h3 className="mt-1 text-xl font-bold text-ink">{formatDate(day.dateKey)}</h3></div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-surface-inset text-ink-muted" aria-label="Close">×</button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Detail label="Readiness" value={day.readiness === null ? "Not available" : `${day.readiness}/100`} />
          <Detail label="Hydration" value={`${day.hydration.totalMl}/${day.hydration.goalMl} ml`} />
          <Detail label="Sleep" value={`${day.wellness.sleepHours ?? "—"} h · ${day.wellness.sleepQuality ?? "—"}/10`} />
          <Detail label="Mood" value={`${day.wellness.mood ?? "—"}/10`} />
          <Detail label="Soreness" value={`${day.wellness.soreness ?? "—"}/10`} />
          <Detail label="Fatigue" value={`${day.wellness.fatigue ?? "—"}/10`} />
        </div>
        <div className="mt-5 space-y-2">
          {day.sessions.map((session) => (
            <article key={session.id} className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between gap-3"><p className="font-bold text-ink">{session.title}</p><span className="rounded-full bg-surface-inset px-2 py-1 text-[9px] font-bold uppercase text-ink-muted">{session.status}</span></div>
              <p className="mt-2 text-xs text-ink-muted">{session.actualDurationMinutes ?? "—"} min · RPE {session.effortRating ?? "—"} · load {session.sessionLoad ?? "—"} AU</p>
            </article>
          ))}
        </div>
        {day.note ? <p className="mt-5 rounded-2xl bg-warn/[0.06] p-4 text-xs leading-relaxed text-ink-muted">{day.note}</p> : null}
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-inset p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">{label}</p><p className="nums mt-1 text-sm font-bold text-ink">{value}</p></div>;
}
