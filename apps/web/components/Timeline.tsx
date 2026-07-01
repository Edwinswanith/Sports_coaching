export type FeedKind =
  | "session"
  | "rpe"
  | "attendance"
  | "recovery"
  | "comment"
  | "note"
  | "performance"
  | "injury";

export type FeedItem = {
  id: string;
  at: string;
  kind: FeedKind;
  title: string;
  detail?: string;
  band?: "green" | "amber" | "red";
};

function rel(at: string): string {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return at.slice(5, 10);
}

function dotColor(it: FeedItem): string {
  if (it.band === "green") return "var(--ok)";
  if (it.band === "amber") return "var(--warn)";
  if (it.band === "red") return "var(--bad)";
  if (it.kind === "comment" || it.kind === "note") return "var(--accent)";
  return "var(--ink-faint)";
}

/** Strava-style merged activity feed — a labelled vertical timeline. */
export function Timeline({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-ink-faint">No recent activity.</p>;
  }
  return (
    <ol className="relative space-y-3 pl-5">
      <span className="absolute bottom-1 left-[4px] top-2 w-px bg-line" aria-hidden />
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span
            className="absolute -left-[18px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-raised"
            style={{ background: dotColor(it), boxShadow: `0 0 6px ${dotColor(it)}` }}
            aria-hidden
          />
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium leading-snug text-ink">{it.title}</p>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">{rel(it.at)}</span>
          </div>
          {it.detail ? <p className="text-[11px] leading-snug text-ink-muted">{it.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
