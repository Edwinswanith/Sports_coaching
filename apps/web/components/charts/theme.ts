// Concrete chart colors that MIRROR the design tokens in app/globals.css.
// Recharts paints SVG presentation attributes (not CSS) so CSS vars won't
// resolve there — keep this in sync with globals.css if the palette changes.
export const CHART = {
  accent: "#0b7d55", // deep emerald — mirrors --accent
  accentStrong: "#0a6e4d",
  energy: "#e0892b", // refined amber — effort/training-load, NEVER status
  ok: "#16a34a",
  warn: "#ca8a04",
  bad: "#dc2626",
  ink: "#121816",
  inkMuted: "#5a645e",
  inkFaint: "#747e77",
  grid: "rgba(17,30,17,0.08)",
  // Per-metric series colors — kept visually DISTINCT so overlaid lines never
  // collide. Readiness=emerald, recovery=blue, attendance=blue (separate chart),
  // load=amber. Wellness sub-scores are colored by good/bad trend, not hue.
  readiness: "#0b7d55", // emerald — mirrors brand accent
  load: "#e0892b", // amber — "effort"/energy, never status
  recovery: "#3366e0", // blue — distinct from the emerald readiness line
  attendance: "#2f7df6", // blue (only appears in the squad chart, not with recovery)
  sleep: "#2f7df6", // blue
} as const;

export const bandColor = (b?: string | null): string =>
  b === "red" ? CHART.bad : b === "amber" ? CHART.warn : CHART.ok;

/** "2026-06-09" → "Jun 9" (UTC, no TZ drift). */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
