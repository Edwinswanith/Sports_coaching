"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CHART, shortDate } from "./theme";

export type SeriesDef = {
  key: string;
  label: string;
  color: string;
  kind?: "line" | "area" | "bar";
  axis?: "left" | "right";
  dot?: boolean;
};

type TooltipEntry = { name?: string; value?: number | string | null; color?: string };

function TooltipBox({
  active,
  payload,
  label,
  xFormat,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  xFormat: (v: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 shadow-raised">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {xFormat(String(label))}
      </p>
      {payload.map((e, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px]">
          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
          <span className="text-ink-muted">{e.name}</span>
          <span className="nums ml-auto font-semibold text-ink">
            {e.value === null || e.value === undefined ? "—" : e.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Custom legend that names each series and flags the one(s) on the secondary
 * (right) axis — so a reader instantly knows the bars are on a different scale
 * from the lines, instead of guessing. Bars get a square swatch, lines a dot.
 */
function SeriesLegend({ series }: { series: SeriesDef[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            className={s.kind === "bar" ? "h-2 w-2 rounded-[2px]" : "h-2 w-2 rounded-full"}
            style={{ background: s.color }}
          />
          <span>{s.label}</span>
          {s.axis === "right" ? (
            <span className="rounded bg-surface-inset px-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
              right scale
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Generic themed time-series chart. Mixes line/area/bar series on one or two
 * Y-axes. Gaps (null) are connected so a missing day doesn't read as zero.
 */
export function SeriesChart({
  data,
  series,
  xKey = "date",
  height = 220,
  leftDomain,
  rightDomain,
  xFormat = shortDate,
  showLegend = true,
}: {
  data: Array<Record<string, unknown>>;
  series: SeriesDef[];
  xKey?: string;
  height?: number;
  leftDomain?: [number | string, number | string];
  rightDomain?: [number | string, number | string];
  xFormat?: (v: string) => string;
  showLegend?: boolean;
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          tick={{ fontSize: 10, fill: CHART.inkFaint }}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          minTickGap={24}
        />
        <YAxis
          yAxisId="left"
          domain={leftDomain}
          tick={{ fontSize: 10, fill: CHART.inkFaint }}
          tickLine={false}
          axisLine={false}
          width={30}
        />
        {hasRight ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={rightDomain}
            tick={{ fontSize: 10, fill: CHART.inkFaint }}
            tickLine={false}
            axisLine={false}
            width={30}
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: CHART.grid, strokeWidth: 1 }}
          content={<TooltipBox xFormat={xFormat} />}
        />
        {showLegend ? (
          <Legend content={<SeriesLegend series={series} />} />
        ) : null}
        {series.map((s) => {
          const yAxisId = s.axis === "right" ? "right" : "left";
          if (s.kind === "bar") {
            return (
              <Bar key={s.key} yAxisId={yAxisId} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={26} />
            );
          }
          if (s.kind === "area") {
            return (
              <Area
                key={s.key}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.14}
                strokeWidth={2}
                connectNulls
                dot={false}
                activeDot={{ r: 3 }}
              />
            );
          }
          return (
            <Line
              key={s.key}
              yAxisId={yAxisId}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              connectNulls
              dot={s.dot ? { r: 2, fill: s.color } : false}
              activeDot={{ r: 3 }}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
