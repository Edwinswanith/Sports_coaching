"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "../../../components/Card";
import { bandFor } from "../../../components/Ring";
import { Chip, dash, Icon } from "../../../components/ui";
import { AppShell } from "../../../components/AppShell";
import { coachNav, coachNavigate } from "../../../lib/coachNav";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../lib/api";

type Athlete = {
  athleteId: string;
  userId: string;
  name: string;
  email: string;
  sport: string;
  position: string | null;
};

type DailySummary = {
  athleteId: string;
  sport: string;
  position: string | null;
  attendance: { status: string | null };
  readinessScore: number | null;
  injury: { active: boolean; bodyPart: string | null };
  rpe: { calculatedTrainingLoad: number; riskFlag: "green" | "amber" | "red" } | null;
};

type RosterFilter = "all" | "attention" | "injury" | "nocheck";

const ROSTER_FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Attention" },
  { key: "injury", label: "Injury" },
  { key: "nocheck", label: "No check-in" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function attentionRank(summary: DailySummary | undefined): number {
  if (!summary) return 3;
  if (summary.rpe?.riskFlag === "red") return 0;
  if (summary.injury.active) return 0.5;
  if (summary.readinessScore !== null && summary.readinessScore < 60) return 1;
  if (summary.rpe?.riskFlag === "amber") return 1.5;
  if (summary.readinessScore !== null && summary.readinessScore < 80) return 2;
  return 3;
}

export default function CoachRosterPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [summaries, setSummaries] = useState<Record<string, DailySummary>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [rosterRes, summaryRes] = await Promise.all([
          apiFetch("/api/coach/athletes"),
          apiFetch(`/api/coach/dashboard?date=${today()}`),
        ]);
        if (!rosterRes.ok) {
          if (isAuthFailure(rosterRes.status)) {
            clearSession();
            router.replace("/");
            return;
          }
          throw new Error("load_failed");
        }
        const rosterJson = (await rosterRes.json()) as { athletes?: Athlete[] };
        const summaryJson = summaryRes.ok
          ? ((await summaryRes.json()) as { cards?: DailySummary[] })
          : { cards: [] };
        if (!cancelled) {
          setAthletes(rosterJson.athletes ?? []);
          setSummaries(Object.fromEntries((summaryJson.cards ?? []).map((card) => [card.athleteId, card])));
        }
      } catch {
        if (!cancelled) setError("Unable to load your roster.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...athletes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((athlete) => {
        const summary = summaries[athlete.athleteId];
        if (
          q &&
          !athlete.name.toLowerCase().includes(q) &&
          !athlete.sport.toLowerCase().includes(q) &&
          !(athlete.position ?? "").toLowerCase().includes(q)
        )
          return false;
        if (filter === "attention") return attentionRank(summary) < 2;
        if (filter === "injury") return Boolean(summary?.injury.active);
        if (filter === "nocheck") return !summary || summary.readinessScore === null;
        return true;
      });
  }, [athletes, filter, query, summaries]);

  const counts = useMemo(
    () => ({
      attention: Object.values(summaries).filter((summary) => attentionRank(summary) < 2).length,
      injury: Object.values(summaries).filter((summary) => summary.injury.active).length,
      nocheck: Object.values(summaries).filter((summary) => summary.readinessScore === null).length,
    }),
    [summaries]
  );

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = coachNav(user?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  return (
    <AppShell
      role="coach"
      title="Roster"
      subtitle={`${athletes.length} assigned athlete${athletes.length === 1 ? "" : "s"}`}
      userName={user?.name}
      nav={nav}
      activeKey="roster"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                <Icon.search />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                placeholder="Search by name, sport, or position..."
                className="field pl-9"
              />
            </div>
            <Link href="/coach/athletes/new" className="btn-primary h-11 shrink-0 px-3 text-xs" aria-label="Add athlete">
              + Add
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ROSTER_FILTERS.map((item) => {
              const active = item.key === filter;
              const count =
                item.key === "attention"
                  ? counts.attention
                  : item.key === "injury"
                  ? counts.injury
                  : item.key === "nocheck"
                  ? counts.nocheck
                  : 0;
              return (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key)}
                  aria-pressed={active}
                  className={`chip transition ${
                    active ? "bg-accent text-accent-ink" : "border border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  {item.key !== "all" && count > 0 ? ` ${count}` : ""}
                </button>
              );
            })}
            <span className="nums ml-auto self-center text-[10px] text-ink-faint">
              {filtered.length} of {athletes.length}
            </span>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
        ) : null}

        {loading ? (
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="surface-card h-24 animate-pulse" />
            ))}
          </div>
        ) : athletes.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">No athletes on your squad yet.</p>
            <Link href="/coach/athletes/new" className="btn-primary mt-3 inline-flex">
              Add your first athlete
            </Link>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">No athletes match your search or filter.</p>
          </Card>
        ) : (
          <div className="grid gap-2">
            {filtered.map((athlete) => (
              <RosterRow key={athlete.athleteId} athlete={athlete} summary={summaries[athlete.athleteId]} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function RosterRow({ athlete, summary }: { athlete: Athlete; summary?: DailySummary }) {
  const band = summary ? bandFor(summary.readinessScore) : null;
  const text =
    band === "red"
      ? "text-bad"
      : band === "amber"
      ? "text-warn"
      : band === "green"
      ? "text-ok"
      : "text-accent-strong";
  const ring =
    band === "red"
      ? "border-bad/40"
      : band === "amber"
      ? "border-warn/40"
      : band === "green"
      ? "border-ok/40"
      : "border-accent/20";
  const flagged = attentionRank(summary) < 2;
  const edge =
    flagged && summary?.rpe?.riskFlag === "red"
      ? "ring-1 ring-bad/30"
      : flagged
      ? "ring-1 ring-warn/30"
      : "";

  return (
    <Link
      href={`/coach/athletes/${athlete.athleteId}`}
      className={`surface-card animate-rise flex items-center gap-3 p-3 transition hover:border-accent/40 hover:shadow-glow ${edge}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-sm font-bold ${ring} ${text}`}>
        {summary ? summary.readinessScore ?? "-" : initials(athlete.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-display text-sm font-semibold text-ink">{athlete.name}</span>
          {summary?.injury.active ? <Chip band="red">injury</Chip> : null}
          {summary?.rpe ? <Chip band={summary.rpe.riskFlag}>{summary.rpe.riskFlag}</Chip> : null}
        </span>
        <span className="block truncate text-[11px] text-ink-muted">
          {dash(athlete.sport)}
          {athlete.position ? ` · ${athlete.position}` : ""} · {dash(summary?.attendance.status)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {summary?.rpe ? (
          <>
            <span className="nums block font-display text-base font-bold leading-none text-ink">
              {summary.rpe.calculatedTrainingLoad}
            </span>
            <span className="text-[10px] text-ink-faint">load</span>
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">no rpe</span>
        )}
      </span>
      <span className="shrink-0 text-ink-faint">
        <Icon.chevron />
      </span>
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
