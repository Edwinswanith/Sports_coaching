"use client";

import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";

/**
 * Compact Recharts sparkline for "one signal per row" layouts. Built on the same
 * charting package as the full panels (not hand-drawn SVG) so styling, tooltips,
 * and rendering stay consistent. Null entries are left as gaps (a missing day
 * doesn't read as a zero), and the latest point is dotted.
 */
export function Sparkline({
  values,
  color,
  width = 100,
  height = 30,
}: {
  values: Array<number | null>;
  color: string;
  width?: number | string;
  height?: number;
}) {
  const data = values.map((v, i) => ({ i, v }));
  const hasData = values.some((v) => v !== null && Number.isFinite(v));
  if (!hasData) {
    return <div style={{ width, height }} className="rounded bg-surface-inset" aria-hidden />;
  }

  // Index of the last non-null point — only that dot is drawn.
  let lastI = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) {
      lastI = i;
      break;
    }
  }

  return (
    <div style={{ width, height }} className="shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            strokeLinecap="round"
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === lastI && props.cx != null && props.cy != null ? (
                <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} fill={color} />
              ) : (
                <g key={props.index} />
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
