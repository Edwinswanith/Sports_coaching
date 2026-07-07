"use client";

import { useId } from "react";
import CountUp from "react-countup";
import { Cell, Pie, PieChart } from "recharts";

type Band = "green" | "amber" | "red";

const BAND_COLOR: Record<Band, string> = {
  green: "var(--ok)",
  amber: "var(--warn)",
  red: "var(--bad)",
};

// Two-tone gradient per band — a light→deep sweep gives the arc a premium,
// "instrument-cluster" feel instead of a flat single colour.
const BAND_GRADIENT: Record<Band, [string, string]> = {
  green: ["#86e05a", "#16a34a"],
  amber: ["#f6c844", "#ca8a04"],
  red: ["#f87171", "#dc2626"],
};

export function bandFor(score: number | null | undefined): Band {
  if (score === null || score === undefined) return "amber";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}

/**
 * The signature metric of the product — a WHOOP/Oura-style readiness ring.
 * Renders a value 0–100 as a gradient arc with an animated count-up number.
 */
export function Ring({
  value,
  size = 132,
  stroke = 11,
  band,
  label,
  caption,
  animate = true,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  band?: Band;
  label?: string;
  caption?: string;
  animate?: boolean;
}) {
  const gradId = `ring-grad-${useId()}`;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const resolved: Band = band ?? bandFor(value);
  const color = BAND_COLOR[resolved];
  const [g0] = BAND_GRADIENT[resolved];
  const chartData = [
    { name: "score", value: pct },
    { name: "remaining", value: Math.max(0, 100 - pct) },
  ];
  const outerRadius = size / 2 - 2;
  const innerRadius = Math.max(0, outerRadius - stroke);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
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
          isAnimationActive={animate}
          animationDuration={850}
        >
          <Cell fill={value === null ? "var(--surface-inset)" : `url(#${gradId})`} />
          <Cell fill="var(--surface-inset)" />
        </Pie>
      </PieChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`nums font-display font-bold leading-none ${size < 120 ? "text-3xl" : "text-4xl"}`}
          style={{ color }}
        >
          {value === null ? (
            "—"
          ) : animate ? (
            <CountUp end={Math.round(value)} duration={1.1} preserveValue />
          ) : (
            Math.round(value)
          )}
        </span>
        {label ? (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {label}
          </span>
        ) : null}
        {caption ? <span className="mt-0.5 text-[10px] text-ink-faint">{caption}</span> : null}
      </div>
    </div>
  );
}
