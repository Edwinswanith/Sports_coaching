import { summarizeTrend, type TrendSummary } from "./charts/trendStats";
import { Sparkline } from "./charts/Sparkline";
import { CHART } from "./charts/theme";

export type TrendPoint = {
  date: string;
  readiness: number | null;
  load: number | null;
  sleepHours: number | null;
  recoveryScore: number | null;
};

// `neutral` metrics (training load) aren't inherently good or bad — show
// direction without a green/red verdict. Readiness & sleep: higher is better.
// Colors are hex (CHART.*), not CSS vars: Recharts paints SVG stroke attributes
// where `var(--…)` won't resolve. The same hex works for the CSS text color too.
const ACCESSOR: Record<
  string,
  { key: keyof TrendPoint; color: string; fmt?: (n: number) => string; neutral?: boolean }
> = {
  Readiness: { key: "readiness", color: CHART.readiness },
  Load: { key: "load", color: CHART.load, neutral: true },
  Sleep: { key: "sleepHours", color: CHART.ok, fmt: (n) => `${n}h` },
};

/** Inline direction marker: ▲/▼/→, tinted good/bad (or neutral) for the metric. */
function DeltaCaret({ summary, neutral }: { summary: TrendSummary | null; neutral?: boolean }) {
  if (!summary) return null;
  if (neutral) {
    const arrow = summary.rose === null ? "→" : summary.rose ? "▲" : "▼";
    return <span className="nums text-[10px] font-bold text-ink-faint">{arrow}</span>;
  }
  const m =
    summary.dir === "improving"
      ? { c: "text-ok", a: "▲" }
      : summary.dir === "declining"
      ? { c: "text-bad", a: "▼" }
      : { c: "text-ink-faint", a: "→" };
  return <span className={`nums text-[10px] font-bold ${m.c}`}>{m.a}</span>;
}

export function TrendRow({ label, series }: { label: keyof typeof ACCESSOR; series: TrendPoint[] }) {
  const meta = ACCESSOR[label];
  const values = series.map((p) => p[meta.key] as number | null);
  const last = [...values].reverse().find((v) => v !== null) ?? null;
  const summary = summarizeTrend(values, { lowerIsBetter: false });
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="flex items-baseline gap-1">
          <DeltaCaret summary={summary} neutral={meta.neutral} />
          <span className="nums font-display text-sm font-semibold" style={{ color: meta.color }}>
            {last === null ? "—" : meta.fmt ? meta.fmt(last) : Math.round(last)}
          </span>
        </span>
      </div>
      <div className="mt-1">
        <Sparkline values={values} color={meta.color} width="100%" height={40} />
      </div>
    </div>
  );
}

/** Compact multi-series trend block for a daily-card surface. */
export function Trends({ series }: { series: TrendPoint[] }) {
  return (
    <div className="space-y-3">
      <TrendRow label="Readiness" series={series} />
      <TrendRow label="Load" series={series} />
      <TrendRow label="Sleep" series={series} />
    </div>
  );
}
