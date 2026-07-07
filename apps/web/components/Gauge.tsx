"use client";

import { useId, type ReactNode } from "react";
import { Cell, Pie, PieChart } from "recharts";

export type GaugeBand = "green" | "amber" | "red" | "neutral";

const BAND_COLOR: Record<GaugeBand, string> = {
  green: "var(--ok)",
  amber: "var(--warn)",
  red: "var(--bad)",
  neutral: "var(--ink-faint)",
};

// Two-tone gradient per band, same "instrument-cluster" sweep as the
// readiness Ring, so guardian metrics feel like one design family.
const BAND_GRADIENT: Record<GaugeBand, [string, string]> = {
  green: ["#86e05a", "#16a34a"],
  amber: ["#f6c844", "#ca8a04"],
  red: ["#f87171", "#dc2626"],
  neutral: ["#c7ccc9", "#9aa39a"],
};

/**
 * Small recharts donut gauge — a generic version of Ring for metrics that
 * aren't a 0–100 readiness score (e.g. a 1–5 sleep rating, or a intake/goal
 * ratio). `pct` drives the arc fill (0–100); `displayValue`/`displayUnit` are
 * rendered as their own center label independent of the fill percentage.
 */
export function Gauge({
  pct,
  band,
  size = 84,
  stroke = 9,
  displayValue,
  displayUnit,
}: {
  pct: number;
  band: GaugeBand;
  size?: number;
  stroke?: number;
  displayValue: ReactNode;
  displayUnit?: ReactNode;
}) {
  const gradId = `gauge-grad-${useId()}`;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = BAND_COLOR[band];
  const [g0] = BAND_GRADIENT[band];
  const chartData = [
    { name: "value", value: clamped },
    { name: "remaining", value: Math.max(0, 100 - clamped) },
  ];
  const outerRadius = size / 2 - 2;
  const innerRadius = Math.max(0, outerRadius - stroke);

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={g0} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <Pie
          data={chartData}
          dataKey="value"
          cx="50%"
          cy="50%"
          startAngle={90}
          endAngle={-270}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          cornerRadius={stroke}
          stroke="none"
          isAnimationActive
          animationDuration={700}
        >
          <Cell fill={`url(#${gradId})`} />
          <Cell fill="var(--surface-inset)" />
        </Pie>
      </PieChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="nums font-display text-base font-bold leading-none" style={{ color }}>
          {displayValue}
        </span>
        {displayUnit ? <span className="mt-0.5 text-[9px] font-semibold text-ink-faint">{displayUnit}</span> : null}
      </div>
    </div>
  );
}
