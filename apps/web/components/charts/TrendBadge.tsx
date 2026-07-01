"use client";

import type { ReactNode } from "react";
import { type TrendSummary, fmtMagnitude } from "./trendStats";

/**
 * Plain-language verdict pill: "▲ Improving 6%" (green) / "▼ Declining" (red) /
 * "→ Steady" (gray). Already direction-aware via summarizeTrend, so a falling
 * sprint time reads as Improving. Pass `neutral` for metrics that aren't good or
 * bad (e.g. training load) — it shows Rose / Fell / Steady without a judgment.
 */
export function TrendBadge({
  summary,
  neutral = false,
  unit,
  showMagnitude = true,
}: {
  summary: TrendSummary | null;
  neutral?: boolean;
  unit?: string;
  /** Hide the numeric delta (e.g. on bounded 0–5 scales where % reads oddly). */
  showMagnitude?: boolean;
}) {
  if (!summary) {
    return <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">No data</span>;
  }
  const mag = fmtMagnitude(summary, unit);

  if (neutral) {
    const rose = summary.rose;
    const arrow = rose === null ? "→" : rose ? "▲" : "▼";
    const word = rose === null ? "Steady" : rose ? "Rose" : "Fell";
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full bg-surface-inset px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
        <span className="shrink-0" aria-hidden>{arrow}</span>
        <span className="min-w-0 truncate">{word}</span>
        {showMagnitude && rose !== null ? <span className="nums shrink-0 text-ink-faint">{mag}</span> : null}
      </span>
    );
  }

  const map = {
    improving: { cls: "chip-ok", arrow: "▲", word: "Improving" },
    declining: { cls: "chip-bad", arrow: "▼", word: "Declining" },
    steady: { cls: "bg-surface-inset text-ink-muted", arrow: "→", word: "Steady" },
  } as const;
  const m = map[summary.dir];
  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      <span className="shrink-0" aria-hidden>{m.arrow}</span>
      <span className="min-w-0 truncate">{m.word}</span>
      {showMagnitude && summary.dir !== "steady" ? <span className="nums shrink-0">{mag}</span> : null}
    </span>
  );
}

/**
 * Headline tile: big current value + its trend verdict, so the key number reads
 * instantly above the detail chart. `color` tints the value to match its line.
 * (Distinct from ui.tsx `StatTile` — this one is trend-aware and line-colored.)
 */
export function TrendTile({
  label,
  value,
  unit,
  badge,
  color,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  badge?: ReactNode;
  color?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-inset px-2.5 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="nums mt-0.5 font-display text-xl font-bold leading-none" style={color ? { color } : undefined}>
        {value}
        {unit ? <span className="ml-0.5 text-xs font-semibold text-ink-faint">{unit}</span> : null}
      </p>
      {badge ? <div className="mt-1.5 min-w-0 overflow-hidden">{badge}</div> : null}
    </div>
  );
}
