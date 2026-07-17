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
  const recentDays = [...days].reverse().slice(0, 4);

  return (
    <div className="space-y-3 lg:space-y-5" data-testid="progress-view">
      <section className="relative shrink-0 overflow-hidden rounded-[1.25rem] bg-[#15382e] p-3 text-white shadow-hero lg:rounded-[2rem] lg:p-6">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[42px] border-white/[0.04]" />
        <div className="relative">
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-[#8ad8b7] lg:text-[10px]">Evidence, not guesswork</p>
          <h2 className="mt-0.5 line-clamp-1 text-base font-bold tracking-[-0.04em] lg:mt-2 lg:text-3xl">Aarav is trending forward.</h2>
          <p className="mt-0.5 line-clamp-1 text-[9px] leading-relaxed text-white/60 lg:mt-2 lg:line-clamp-none lg:max-w-xl lg:text-sm">
            {formatDate(summary.startDate)} to {formatDate(summary.endDate)} · benchmarks, readiness, completion, hydration and calculated training load.
          </p>
          <div className="mt-1.5 flex rounded-xl border border-white/10 bg-white/[0.06] p-1 lg:mt-5" aria-label="Progress period">
            {([7, 14, 30] as ProgressRangeDays[]).map((range) => (
              <button
                type="button"
                key={range}
                onClick={() => setRangeDays(range)}
                className={`flex-1 rounded-lg px-2 py-1 text-[9px] font-bold transition lg:px-3 lg:py-2 lg:text-xs ${rangeDays === range ? "bg-white text-[#15382e]" : "text-white/60 hover:text-white"}`}
                aria-pressed={rangeDays === range}
              >
                {range} days
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid shrink-0 grid-cols-2 gap-1.5 lg:gap-3 xl:grid-cols-4">
        <MetricCard label="Average readiness" value={summary.stats.averageReadiness === null ? "—" : `${summary.stats.averageReadiness.toFixed(1)}`} suffix="/100" helper="Calculated from recorded wellness" />
        <MetricCard label="Training completion" value={`${summary.stats.trainingCompletionPercent}`} suffix="%" helper={`${summary.stats.recordedDays} days reviewed`} />
        <MetricCard label="Hydration goal" value={`${summary.stats.hydrationGoalPercent}`} suffix="%" helper="Days at or above target" />
        <MetricCard label="Session load" value={summary.stats.totalSessionLoad.toLocaleString("en-IN")} suffix="AU" helper="Duration × effort" />
      </section>

      <section className="shrink-0 rounded-[1.1rem] border border-line bg-white p-2.5 shadow-raised lg:rounded-[1.6rem] lg:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent-strong lg:text-[10px]">Trend lines</p>
            <h3 className="line-clamp-1 text-xs font-bold text-ink lg:mt-1 lg:text-lg">Readiness and hydration consistency</h3>
          </div>
          <span className="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[7px] font-bold uppercase tracking-wider text-ink-faint lg:text-[9px]">{rangeDays} days</span>
        </div>
        <div className="mt-1.5 h-[72px] w-full lg:mt-5 lg:h-72" aria-label="Readiness and hydration line chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 6, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6ece8" />
              <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#738078" }} minTickGap={16} />
              <YAxis domain={[0, 110]} tick={{ fontSize: 8, fill: "#738078" }} width={24} />
              <Tooltip contentStyle={{ borderRadius: 14, borderColor: "#dfe7e2", fontSize: 11 }} />
              <Line type="monotone" dataKey="readiness" name="Readiness" stroke="#0f7656" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="hydration" name="Hydration %" stroke="#55a8d4" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex gap-3 text-[8px] font-semibold text-ink-muted lg:mt-2 lg:text-[10px]">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#0f7656]" /> Readiness</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#55a8d4]" /> Hydration goal %</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-1.5 lg:gap-5">
        <div className="flex flex-col rounded-[1.1rem] border border-line bg-white p-2.5 shadow-raised lg:rounded-[1.6rem] lg:p-5">
          <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent-strong lg:text-[10px]">Performance benchmarks</p>
          <h3 className="line-clamp-1 text-xs font-bold text-ink lg:mt-1 lg:text-lg">First to latest recorded test</h3>
          <div className="mt-1.5 space-y-1 lg:mt-4 lg:grid lg:grid-cols-2 lg:gap-2 lg:space-y-0">
            {summary.benchmarks.length ? summary.benchmarks.map((delta) => (
              <article key={delta.metric} className="rounded-lg border border-line bg-[#fafbf9] p-2 lg:rounded-2xl lg:p-4">
                <p className="line-clamp-1 text-[9px] font-semibold text-ink-muted lg:text-xs">{PERFORMANCE_METRICS[delta.metric].label}</p>
                <p className="nums mt-0.5 text-xs font-bold text-ink lg:mt-2 lg:text-lg">{formatBenchmarkDelta(delta)}</p>
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-ok lg:mt-2 lg:text-[10px]">Improving</p>
              </article>
            )) : <p className="text-[10px] text-ink-muted lg:text-sm">Two benchmark observations are required in this range.</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 lg:gap-5">
          <div className="shrink-0 rounded-[1.1rem] border border-line bg-white p-2.5 shadow-raised lg:rounded-[1.6rem] lg:p-5">
            <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent-strong lg:text-[10px]">Triggered priorities</p>
            <h3 className="line-clamp-1 text-xs font-bold text-ink lg:mt-1 lg:text-lg">Deterministic review thresholds</h3>
            <div className="mt-1.5 space-y-1 lg:mt-4 lg:space-y-2">
              {summary.priorities.map((priority) => (
                <div key={priority} className="flex gap-2 rounded-lg border border-warn/15 bg-warn/[0.055] p-2 lg:rounded-2xl lg:p-3.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  <p className="line-clamp-2 text-[9px] leading-relaxed text-ink-muted lg:line-clamp-none lg:text-xs">{priority}</p>
                </div>
              ))}
            </div>
            <p className="mt-1 hidden text-[10px] leading-relaxed text-ink-faint lg:mt-3 lg:block">These are evidence flags. Coach Priya remains the authority for changes to training volume or intensity.</p>
          </div>

          <div className="flex flex-col rounded-[1.1rem] border border-line bg-white p-2.5 shadow-raised lg:rounded-[1.6rem] lg:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent-strong lg:text-[10px]">Daily history</p>
                <h3 className="line-clamp-1 text-xs font-bold text-ink lg:mt-1 lg:text-lg">Open any recorded day</h3>
              </div>
              <span className="shrink-0 text-[9px] font-semibold text-ink-muted lg:text-xs">{days.length} days</span>
            </div>
            <div className="mt-1.5 divide-y divide-line rounded-lg border border-line lg:mt-4 lg:max-h-[430px] lg:overflow-y-auto lg:rounded-2xl">
              {recentDays.map((day) => (
                <button key={day.dateKey} type="button" onClick={() => setSelectedDay(day)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 bg-white px-2 py-1.5 text-left transition hover:bg-surface-inset lg:gap-3 lg:px-4 lg:py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] font-bold text-ink lg:text-sm">{formatDate(day.dateKey)}</span>
                    <span className="mt-0.5 block truncate text-[8px] text-ink-muted lg:text-[10px]">{day.sessions.map((session) => `${session.title}: ${session.status}`).join(" · ")}</span>
                  </span>
                  <span className="nums text-[10px] font-bold text-accent-strong lg:text-sm">{day.readiness ?? "—"}</span>
                  <span className="text-[10px] text-ink-faint">›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {selectedDay ? <DayDetail day={selectedDay} onClose={() => setSelectedDay(null)} /> : null}
    </div>
  );
}

function MetricCard({ label, value, suffix, helper }: { label: string; value: string; suffix: string; helper: string }) {
  return (
    <article className="rounded-[0.95rem] border border-line bg-white px-2.5 py-1.5 shadow-raised lg:rounded-[1.4rem] lg:p-4">
      <p className="line-clamp-1 text-[7px] font-bold uppercase tracking-[0.13em] text-ink-faint lg:text-[10px]">{label}</p>
      <p className="nums mt-0.5 text-lg font-bold tracking-[-0.04em] text-ink lg:mt-2 lg:text-3xl">{value} <span className="text-[10px] font-semibold text-ink-muted lg:text-sm">{suffix}</span></p>
      <p className="mt-0.5 line-clamp-1 text-[8px] text-ink-muted lg:mt-2 lg:line-clamp-none lg:text-[10px]">{helper}</p>
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
