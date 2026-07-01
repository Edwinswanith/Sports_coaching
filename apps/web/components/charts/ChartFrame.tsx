"use client";

import type { ReactNode } from "react";

/**
 * Card shell for a chart: title row (+ optional action), and loading / empty /
 * error states sized to `height` so the layout doesn't jump while data loads.
 */
export function ChartFrame({
  title,
  subtitle,
  action,
  loading,
  error,
  empty,
  height = 220,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  height?: number;
  children: ReactNode;
}) {
  return (
    <section className="surface-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="label">{title}</p>
          {subtitle ? <p className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</p> : null}
        </div>
        {action ? <div className="max-w-full shrink-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{action}</div> : null}
      </div>
      {loading ? (
        <div className="animate-pulse rounded-xl bg-surface-inset" style={{ height }} />
      ) : error ? (
        <div className="flex items-center justify-center text-xs text-bad" style={{ height }}>
          Couldn’t load this chart.
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center text-xs text-ink-faint" style={{ height }}>
          No data for this range yet.
        </div>
      ) : (
        children
      )}
    </section>
  );
}
