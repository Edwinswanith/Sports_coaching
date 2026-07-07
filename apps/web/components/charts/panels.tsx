"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChartFrame } from "./ChartFrame";
import { SeriesChart, type SeriesDef } from "./SeriesChart";
import { useSeries } from "./useSeries";
import { CHART, shortDate } from "./theme";
import { summarizeTrend, fmtValue, fmtMagnitude } from "./trendStats";
import { TrendBadge, TrendTile } from "./TrendBadge";
import { Sparkline } from "./Sparkline";

/** Wellness sub-scores are stored on a 1–5 scale but shown out of 10. */
function wellnessTen(v: number): string {
  return String(Math.max(1, Math.min(10, Math.round(1 + ((v - 1) * 9) / 4))));
}

/** Pull one metric's column out of a series array (preserving null gaps). */
function column<T extends Record<string, unknown>>(series: T[], key: keyof T): Array<number | null> {
  return series.map((p) => {
    const v = p[key];
    return typeof v === "number" ? v : null;
  });
}

/** Latest non-null value in a column, or null. */
function latest(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

/**
 * "At a glance" footer beneath a single-metric chart: a plain-language verdict
 * plus the distribution (avg / best / range) — turning the line into an
 * understandable summary and using the space the tabbed layout freed up. Derived
 * from the series already loaded (no extra fetch); renders nothing without data.
 */
function ChartInsight({
  label,
  values,
  unit = "",
  lowerIsBetter = false,
  periodDays,
}: {
  label: string;
  values: Array<number | null>;
  unit?: string;
  lowerIsBetter?: boolean;
  periodDays: number;
}) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 3) return null;
  const sum = summarizeTrend(values, { lowerIsBetter });
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const best = lowerIsBetter ? min : max;
  const verdict =
    !sum || sum.dir === "steady"
      ? { word: "Steady", cls: "text-ink-muted" }
      : sum.dir === "improving"
      ? { word: "Improving", cls: "text-ok" }
      : { word: "Needs attention", cls: "text-bad" };
  const move =
    !sum || sum.dir === "steady"
      ? `barely changed over the last ${periodDays} days`
      : `${sum.rose ? "up" : "down"} ${fmtMagnitude(sum)} over the last ${periodDays} days`;
  const u = unit ? ` ${unit}` : "";
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-inset p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">At a glance · {label}</p>
      <p className="mt-1 text-[12px] leading-snug text-ink-muted">
        <span className={`font-semibold ${verdict.cls}`}>{verdict.word}</span> — {move}.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span>Avg <span className="nums font-semibold text-ink">{fmtValue(avg)}{u}</span></span>
        <span>Best <span className="nums font-semibold text-ink">{fmtValue(best)}{u}</span></span>
        <span>Range <span className="nums font-semibold text-ink">{fmtValue(min)}–{fmtValue(max)}{u}</span></span>
      </div>
    </div>
  );
}

/** "How to read this" footer — a plain-language explainer of what the chart shows. */
function ChartAbout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-inset/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">How to read this</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

type TrendResp = {
  series: Array<{ date: string; readiness: number | null; load: number | null; sleepHours: number | null; recoveryScore: number | null }>;
};
type WellnessResp = {
  series: Array<{ date: string; sleepQuality: number | null; mood: number | null; stress: number | null; soreness: number | null; fatigue: number | null; wakeHr?: number | null; bedHr?: number | null; waterPct?: number | null }>;
};
type PerfResp = { metrics: string[]; series: Array<{ date: string; value: number; metric: string; unit: string }> };
type SquadResp = {
  series: Array<{ date: string; avgReadiness: number | null; attendanceRate: number | null; avgLoad: number | null; redFlags: number; athleteCount: number }>;
};

function DaysToggle({ days, setDays, options }: { days: number; setDays: (d: number) => void; options: number[] }) {
  return (
    <div className="flex gap-1">
      {options.map((d) => (
        <button
          key={d}
          onClick={() => setDays(d)}
          className={`h-7 rounded-md px-2 text-[11px] font-semibold transition ${
            days === d ? "bg-accent text-accent-ink" : "border border-line text-ink-muted hover:text-ink"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

const allNull = (xs: Array<number | null>) => xs.every((v) => v === null);

/** Readiness + recovery (left, 0–100) lines with training load (right) bars. */
export function PerformanceTrendPanel({ base }: { base: string }) {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useSeries<TrendResp>(`${base}/trends?days=${days}`);
  const series = data?.series ?? [];
  const empty = !loading && (series.length === 0 || allNull(series.map((p) => p.readiness)));
  const defs: SeriesDef[] = [
    { key: "load", label: "Load", color: CHART.load, kind: "bar", axis: "right" },
    { key: "readiness", label: "Readiness", color: CHART.readiness },
    { key: "recoveryScore", label: "Recovery", color: CHART.recovery },
  ];
  const readinessCol = column(series, "readiness");
  const recoveryCol = column(series, "recoveryScore");
  const loadCol = column(series, "load");
  const rSum = summarizeTrend(readinessCol);
  const recSum = summarizeTrend(recoveryCol);
  const loadSum = summarizeTrend(loadCol);
  return (
    <ChartFrame
      title="Readiness & training load"
      subtitle="Higher readiness & recovery is better · bars show training effort"
      action={<DaysToggle days={days} setDays={setDays} options={[7, 14, 30]} />}
      loading={loading}
      error={error}
      empty={empty}
      height={290}
    >
      <div className="mb-3 grid grid-cols-3 gap-2">
        <TrendTile
          label="Readiness"
          value={fmtValue(latest(readinessCol) ?? 0)}
          color={CHART.readiness}
          badge={<TrendBadge summary={rSum} />}
        />
        <TrendTile
          label="Recovery"
          value={fmtValue(latest(recoveryCol) ?? 0)}
          color={CHART.recovery}
          badge={<TrendBadge summary={recSum} />}
        />
        <TrendTile
          label="Load"
          value={fmtValue(latest(loadCol) ?? 0)}
          color={CHART.load}
          badge={<TrendBadge summary={loadSum} neutral />}
        />
      </div>
      <SeriesChart data={series} series={defs} leftDomain={[0, 100]} height={250} />
      <ChartInsight label="Readiness" values={readinessCol} periodDays={days} />
      <ChartAbout>
        The <b className="text-ink-muted">green</b> line is your daily readiness (0–100) and{" "}
        <b className="text-ink-muted">blue</b> is recovery — higher is better. Orange bars are training
        load (effort) on the right scale. Readiness falling while load stays high is a cue to ease off
        and recover.
      </ChartAbout>
    </ChartFrame>
  );
}

// Each wellness signal carries its own "which way is good" so the trend reads
// correctly: more sleep/mood = better, but less stress/soreness/fatigue = better.
// Hydration rides along here (as % of the daily goal) instead of its own chart.
const WELLNESS_SIGNALS: Array<{
  key: keyof Omit<WellnessResp["series"][number], "date">;
  label: string;
  lowerIsBetter: boolean;
  unit?: string;
}> = [
  { key: "sleepQuality", label: "Sleep quality", lowerIsBetter: false },
  { key: "mood", label: "Mood", lowerIsBetter: false },
  { key: "stress", label: "Stress", lowerIsBetter: true },
  { key: "soreness", label: "Soreness", lowerIsBetter: true },
  { key: "fatigue", label: "Fatigue", lowerIsBetter: true },
  { key: "waterPct", label: "Hydration", lowerIsBetter: false, unit: "%" },
];

/**
 * Wellness sub-scores (0–5) over time. Shown as one row per signal — value,
 * sparkline, and a good/bad trend verdict — instead of five overlapping lines
 * where "up" meant the opposite thing for different signals. Each row colors its
 * sparkline by whether THAT signal is trending good (green) or bad (red), so the
 * whole panel is scannable without thinking about which direction is good.
 */
export function WellnessTrendPanel({ base }: { base: string }) {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useSeries<WellnessResp>(`${base}/analytics/wellness?days=${days}`);
  const series = data?.series ?? [];
  const empty = !loading && (series.length === 0 || allNull(series.map((p) => p.sleepQuality)));
  return (
    <ChartFrame
      title="Wellness signals"
      subtitle="Daily self-check · trend shows if each is helping or hurting"
      action={<DaysToggle days={days} setDays={setDays} options={[14, 30]} />}
      loading={loading}
      error={error}
      empty={empty}
      height={230}
    >
      <ul className="divide-y divide-line">
        {WELLNESS_SIGNALS.map((sig) => {
          const col = column(series, sig.key);
          const sum = summarizeTrend(col, { lowerIsBetter: sig.lowerIsBetter });
          const now = latest(col);
          const sparkColor = !sum || sum.dir === "steady" ? CHART.inkFaint : sum.dir === "improving" ? CHART.ok : CHART.bad;
          return (
            <li key={String(sig.key)} className="flex items-center gap-3 py-2.5">
              <div className="w-24 shrink-0">
                <p className="truncate text-[12px] font-semibold text-ink">{sig.label}</p>
                <p className="text-[10px] text-ink-faint">{sig.lowerIsBetter ? "lower is better" : "higher is better"}</p>
              </div>
              <div className="min-w-0 flex-1">
                <Sparkline values={col} color={sparkColor} width="100%" />
              </div>
              <p className="nums ml-auto w-12 shrink-0 text-right font-display text-base font-bold text-ink">
                {now === null ? "—" : sig.unit ? fmtValue(now) : wellnessTen(now)}
                <span className="text-[10px] font-medium text-ink-faint">{sig.unit ?? "/10"}</span>
              </p>
              <div className="w-[92px] shrink-0 text-right">
                <TrendBadge summary={sum} showMagnitude={false} />
              </div>
            </li>
          );
        })}
      </ul>
      <ChartAbout>
        Your daily self-check. Each row's badge shows whether it's helping (green) or hurting (red) —
        remember <b className="text-ink-muted">higher is better</b> for sleep, mood & hydration, but{" "}
        <b className="text-ink-muted">lower is better</b> for stress, soreness & fatigue.
      </ChartAbout>
    </ChartFrame>
  );
}

/**
 * Twice-daily resting heart rate (on waking + before bed), in bpm, over time.
 * A lower waking HR trends as "improving" (fitter/better-recovered); the before-
 * bed reading is shown neutrally. Lives on the same wellness analytics endpoint.
 */
export function HeartRatePanel({ base }: { base: string }) {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useSeries<WellnessResp>(`${base}/analytics/wellness?days=${days}`);
  const series = data?.series ?? [];
  const wakeCol = column(series, "wakeHr");
  const bedCol = column(series, "bedHr");
  const empty = !loading && wakeCol.every((v) => v === null) && bedCol.every((v) => v === null);
  const wakeSum = summarizeTrend(wakeCol, { lowerIsBetter: true });
  const bedSum = summarizeTrend(bedCol);
  const defs: SeriesDef[] = [
    { key: "wakeHr", label: "Waking HR", color: "#2f7df6", dot: true },
    { key: "bedHr", label: "Before bed", color: CHART.energy, dot: true },
  ];
  const tile = (col: Array<number | null>) => {
    const v = latest(col);
    return v === null ? "—" : fmtValue(v);
  };
  return (
    <ChartFrame
      title="Resting heart rate"
      subtitle="Twice daily (bpm) · a lower waking HR is better"
      action={<DaysToggle days={days} setDays={setDays} options={[7, 14, 30]} />}
      loading={loading}
      error={error}
      empty={empty}
      height={270}
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <TrendTile label="Waking HR" value={tile(wakeCol)} unit="bpm" color="#2f7df6" badge={<TrendBadge summary={wakeSum} unit="bpm" />} />
        <TrendTile label="Before bed" value={tile(bedCol)} unit="bpm" color={CHART.energy} badge={<TrendBadge summary={bedSum} neutral unit="bpm" />} />
      </div>
      <SeriesChart data={series} series={defs} leftDomain={["auto", "auto"]} height={230} />
      <ChartInsight label="Waking HR" values={wakeCol} unit="bpm" lowerIsBetter periodDays={days} />
      <ChartAbout>
        Resting heart rate on <b className="text-ink-muted">waking</b> (blue) and{" "}
        <b className="text-ink-muted">before bed</b> (amber). A lower, steady waking HR usually means
        good recovery and fitness; a sustained rise can flag fatigue, stress, or illness.
      </ChartAbout>
    </ChartFrame>
  );
}

// Time-based metrics (sprint times etc.) improve as the number goes DOWN.
const TIME_UNITS = new Set(["s", "sec", "secs", "ms", "min"]);
function lowerIsBetterMetric(metric: string | null, unit: string): boolean {
  if (TIME_UNITS.has(unit.toLowerCase())) return true;
  return /time|sprint|\b\d+\s*m\b/i.test(metric ?? "");
}

/** Performance metrics over time, one selectable metric at a time. */
export function PerformancePanel({ base }: { base: string }) {
  const { data, loading, error } = useSeries<PerfResp>(`${base}/analytics/performance?days=90`);
  const metrics = data?.metrics ?? [];
  const [metric, setMetric] = useState<string | null>(null);
  const active = metric ?? metrics[0] ?? null;
  const points = (data?.series ?? []).filter((p) => p.metric === active).map((p) => ({ date: p.date, value: p.value }));
  const unit = data?.series.find((p) => p.metric === active)?.unit ?? "";
  const lowerIsBetter = lowerIsBetterMetric(active, unit);
  const valueCol = points.map((p) => p.value as number | null);
  const sum = summarizeTrend(valueCol, { lowerIsBetter });
  const now = latest(valueCol);
  return (
    <ChartFrame
      title="Performance"
      subtitle={
        active
          ? `${active}${unit ? ` (${unit})` : ""} · ${lowerIsBetter ? "lower is better" : "higher is better"}`
          : "Test results over time"
      }
      action={
        metrics.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {metrics.map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`h-7 rounded-md px-2 text-[11px] font-semibold transition ${
                  active === m ? "bg-accent text-accent-ink" : "border border-line text-ink-muted hover:text-ink"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        ) : undefined
      }
      loading={loading}
      error={error}
      empty={!loading && points.length === 0}
      height={270}
    >
      <div className="mb-3 flex items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Latest</p>
          <p className="nums font-display text-2xl font-bold leading-none text-ink">
            {now === null ? "—" : fmtValue(now)}
            {unit ? <span className="ml-1 text-sm font-semibold text-ink-faint">{unit}</span> : null}
          </p>
        </div>
        <div className="ml-auto">
          <TrendBadge summary={sum} unit={unit} />
        </div>
      </div>
      <SeriesChart
        data={points}
        series={[{ key: "value", label: active ?? "value", color: CHART.accentStrong, dot: true }]}
        leftDomain={["auto", "auto"]}
        showLegend={false}
        height={230}
      />
      <ChartInsight
        label={active ?? "Metric"}
        values={valueCol}
        unit={unit}
        lowerIsBetter={lowerIsBetter}
        periodDays={90}
      />
      <ChartAbout>
        Your test results over time (last 90 days). For timed tests like sprints,{" "}
        <b className="text-ink-muted">lower is better</b>; for strength and jumps,{" "}
        <b className="text-ink-muted">higher is better</b>. Switch metric with the buttons above.
      </ChartAbout>
    </ChartFrame>
  );
}

/** Coach squad rollup: avg readiness + attendance rate (lines) and avg load (bars). */
export function SquadTrendPanel() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useSeries<SquadResp>(`/api/coach/analytics/squad?days=${days}`);
  const series = data?.series ?? [];
  const today = series.at(-1);
  const empty = !loading && (series.length === 0 || allNull(series.map((p) => p.avgReadiness)));
  const defs: SeriesDef[] = [
    { key: "avgLoad", label: "Avg load", color: CHART.load, kind: "bar", axis: "right" },
    { key: "avgReadiness", label: "Avg readiness", color: CHART.readiness },
    { key: "attendanceRate", label: "Attendance %", color: CHART.attendance },
  ];
  const readinessCol = column(series, "avgReadiness");
  const attendanceCol = column(series, "attendanceRate");
  const loadCol = column(series, "avgLoad");
  const rSum = summarizeTrend(readinessCol);
  const aSum = summarizeTrend(attendanceCol);
  const loadSum = summarizeTrend(loadCol);
  return (
    <ChartFrame
      title="Squad analytics"
      subtitle={today ? `Today: ${today.athleteCount} logging · ${today.redFlags} red flag(s)` : "Across your assigned athletes"}
      action={<DaysToggle days={days} setDays={setDays} options={[7, 14, 30]} />}
      loading={loading}
      error={error}
      empty={empty}
      height={240}
    >
      <div className="mb-3 grid grid-cols-3 gap-2">
        <TrendTile
          label="Avg readiness"
          value={fmtValue(latest(readinessCol) ?? 0)}
          color={CHART.readiness}
          badge={<TrendBadge summary={rSum} />}
        />
        <TrendTile
          label="Attendance"
          value={fmtValue(latest(attendanceCol) ?? 0)}
          unit="%"
          color={CHART.attendance}
          badge={<TrendBadge summary={aSum} />}
        />
        <TrendTile
          label="Avg load"
          value={fmtValue(latest(loadCol) ?? 0)}
          color={CHART.load}
          badge={<TrendBadge summary={loadSum} neutral />}
        />
      </div>
      <SeriesChart data={series} series={defs} leftDomain={[0, 100]} />
    </ChartFrame>
  );
}

type NotesInboxResp = {
  openCount: number;
  notes: Array<{ noteId: string; athleteId: string; athleteName: string; date: string; body: string; needsReply: boolean }>;
};

/**
 * Coach inbox of recent athlete notes across the roster, with a needs-reply
 * count badge — so athlete→coach notes are surfaced, not buried in each
 * athlete's activity timeline. Rows link to the athlete (to reply via feedback).
 */
export function CoachNotesInbox() {
  const { data, loading, error } = useSeries<NotesInboxResp>("/api/coach/notes-inbox?days=14");
  const notes = data?.notes ?? [];
  const open = data?.openCount ?? 0;

  return (
    <section className="surface-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="label">Athlete notes</p>
        {!loading && !error ? (
          open > 0 ? (
            <span className="chip chip-warn">{open} need reply</span>
          ) : notes.length > 0 ? (
            <span className="chip chip-ok">all replied</span>
          ) : null
        ) : null}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-faint">last 14 days</span>
      </div>
      {loading ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-inset" />
      ) : error ? (
        <p className="text-xs text-bad">Couldn’t load notes.</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-ink-faint">No notes from your athletes in the last 14 days.</p>
      ) : (
        <ul className="space-y-2">
          {notes.slice(0, 6).map((n) => (
            <li key={n.noteId}>
              <Link
                href={`/coach/athletes/${n.athleteId}`}
                className="block rounded-xl border border-line bg-surface-inset px-3 py-2 transition hover:border-accent/40"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink">{n.athleteName}</span>
                  {n.needsReply ? (
                    <span className="chip chip-warn">needs reply</span>
                  ) : (
                    <span className="chip chip-ok">replied</span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-faint">{shortDate(n.date)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-ink-muted">{n.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
