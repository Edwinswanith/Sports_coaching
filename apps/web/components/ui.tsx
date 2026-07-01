import type { ReactNode } from "react";

type Band = "green" | "amber" | "red";

const CHIP_CLASS: Record<Band, string> = {
  green: "chip-ok",
  amber: "chip-warn",
  red: "chip-bad",
};

/** Status pill — green/amber/red, the physiological status language. */
export function Chip({ band, children }: { band: Band; children: ReactNode }) {
  return <span className={`chip ${CHIP_CLASS[band]}`}>{children}</span>;
}

/** Compact metric tile — a label over a tabular value, with an optional sub-line. */
export function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  // Numbers stay big and prominent; long status words (e.g. "completed",
  // "in_progress") shrink so they fit the narrow tile instead of clipping.
  const isLongText = typeof value === "string" && value.length > 6;
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-inset p-3">
      <div className="flex items-center gap-1.5">
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
        <p className="label">{label}</p>
      </div>
      <p
        className={`nums mt-1 break-words font-display font-semibold leading-tight text-ink ${
          isLongText ? "text-base" : "text-xl"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] text-ink-muted">{sub}</p> : null}
    </div>
  );
}

export function dash(v: string | number | null | undefined) {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

/* ---------- Inline SVG icon set (no dependency) ---------- */

function svg(path: ReactNode, size = 14) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

export const Icon = {
  moon: () => svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />),
  spark: () =>
    svg(<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />),
  pulse: () => svg(<path d="M3 12h4l2-7 4 14 2-7h6" />),
  shield: () =>
    svg(
      <>
        <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
      </>
    ),
  check: () => svg(<path d="M20 6 9 17l-5-5" />),
  flame: () =>
    svg(<path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 11 12 9 12 3Z" />),
  water: () =>
    svg(<path d="M12 3s6 6.1 6 11a6 6 0 0 1-12 0c0-4.9 6-11 6-11Z" />),
  calendar: () =>
    svg(
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </>
    ),
  arrowLeft: () => svg(<path d="M19 12H5m6 7-7-7 7-7" />),
  chevron: () => svg(<path d="m9 6 6 6-6 6" />),
  heart: () =>
    svg(<path d="M12 20s-7-4.35-9.5-8.5C1 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5 3.5 3.5 6.5C19 15.65 12 20 12 20Z" />),
  trophy: () =>
    svg(
      <>
        <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
        <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M9 20h6M12 13v4" />
      </>
    ),
  dumbbell: () =>
    svg(
      <>
        <path d="M6.5 6.5 17.5 17.5M3 8v8M21 8v8M6 5v14M18 5v14" />
      </>
    ),
  home: () =>
    svg(
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </>
    ),
  chart: () =>
    svg(
      <>
        <path d="M4 4v16h16" />
        <path d="M8 14l3-4 3 3 4-6" />
      </>
    ),
  plus: () => svg(<path d="M12 5v14M5 12h14" />),
  message: () => svg(<path d="M4 5h16v11H9l-4 3v-3H4V5Z" />),
  chat: () =>
    svg(
      <>
        <path d="M4 5h16v11H9l-4 3v-3H4V5Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
  users: () =>
    svg(
      <>
        <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
        <circle cx="9" cy="7" r="3.2" />
        <path d="M22 19v-1a4 4 0 0 0-3-3.8M16 3.2A4 4 0 0 1 16 11" />
      </>
    ),
  list: () => svg(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  grid: () =>
    svg(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
  gauge: () =>
    svg(
      <>
        <path d="M12 13l4-4" />
        <path d="M3.5 18a9 9 0 1 1 17 0" />
      </>
    ),
  link: () =>
    svg(
      <>
        <path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1.5" />
        <path d="M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1.5" />
      </>
    ),
  logout: () => svg(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />),
  bell: () =>
    svg(
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
  key: () =>
    svg(
      <>
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="m10.7 12.3 8.3-8.3M15 7l3 3M18 4l3 3" />
      </>
    ),
  search: () =>
    svg(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
  x: () => svg(<path d="M18 6 6 18M6 6l12 12" />),
  eye: () =>
    svg(
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>,
      18
    ),
  eyeOff: () =>
    svg(
      <>
        <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.5 0 10 6 10 6a13.2 13.2 0 0 1-2.2 2.9M6.2 6.3A13.1 13.1 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 4.2-.9" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        <path d="M3 3l18 18" />
      </>,
      18
    ),
};
