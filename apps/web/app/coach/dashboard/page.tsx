"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "../../../components/Card";
import { Ring, bandFor } from "../../../components/Ring";
import { Chip, StatTile, dash, wellnessTen, Icon } from "../../../components/ui";
import { AppShell, type NavItem } from "../../../components/AppShell";
import { BottomSheet } from "../../../components/BottomSheet";
import { TrendRow, type TrendPoint } from "../../../components/Trend";
import { SquadTrendPanel, CoachNotesInbox } from "../../../components/charts/panels";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
} from "../../../lib/api";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../../lib/sessions";
import { coachNav, coachNavigate } from "../../../lib/coachNav";

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  attendance: { status: string | null; note: string | null };
  sessions: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  recovery: { status: string | null; score: number | null; restingHr: number | null; hrv: number | null };
  injury: { active: boolean; bodyPart: string | null; severity: string | null; restriction: string | null };
  rpe: {
    sessionType: SessionSlot;
    trainingCategory: string;
    plannedIntensityPercent: number;
    rpe: number;
    calculatedTrainingLoad: number;
    fatigue: number;
    muscleSoreness: number;
    sleepQuality: number;
    moodMotivation: number;
    bodyConditionFeedback: string | null;
    riskFlag: "green" | "amber" | "red";
    riskReasons?: string[];
    readinessScore?: number;
    readinessBand?: "green" | "amber" | "red";
  } | null;
};

type DashboardResponse = { date: string; count: number; cards: DailyCard[]; error?: string };
type StoredUser = { name: string; email: string; role: string; isAcademyOwner?: boolean };

/** Lower = needs attention sooner. */
function attentionRank(c: DailyCard): number {
  if (c.rpe?.riskFlag === "red") return 0;
  if (c.injury.active) return 0.5;
  if (c.readinessScore !== null && c.readinessScore < 60) return 1;
  if (c.rpe?.riskFlag === "amber") return 1.5;
  if (c.readinessScore !== null && c.readinessScore < 80) return 2;
  return 3;
}

export default function CoachDashboardPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cards, setCards] = useState<DailyCard[]>([]);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = useMemo(
    () =>
      [...cards].sort(
        (a, b) =>
          attentionRank(a) - attentionRank(b) ||
          (a.readinessScore ?? 101) - (b.readinessScore ?? 101)
      ),
    [cards]
  );

  const stats = useMemo(() => {
    const present = cards.filter((c) => c.attendance.status === "present").length;
    const completed = cards.filter((c) =>
      SESSION_SLOTS.some((slot) => c.sessions[slot].status === "completed")
    ).length;
    const withReadiness = cards.filter((c) => c.readinessScore !== null);
    const avgReadiness =
      withReadiness.length === 0
        ? null
        : Math.round(withReadiness.reduce((s, c) => s + (c.readinessScore ?? 0), 0) / withReadiness.length);
    const attention = cards.filter((c) => attentionRank(c) < 2).length;
    return { present, completed, avgReadiness, attention };
  }, [cards]);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      router.replace("/");
      return;
    }
    setUser(storedUser as StoredUser);

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/coach/dashboard?date=${date}`);
        if (!res.ok) {
          if (isAuthFailure(res.status)) {
            clearSession();
            router.replace("/");
            return;
          }
          throw new Error("Unable to load dashboard.");
        }
        const payload = (await res.json()) as DashboardResponse;
        if (!cancelled) setCards(payload.cards ?? []);
      } catch {
        if (!cancelled) setError("Unable to load dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [date, router]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const attentionCards = ranked.filter((c) => attentionRank(c) < 2);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((c) => {
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !(c.sport ?? "").toLowerCase().includes(q) &&
        !(c.position ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filter === "attention") return attentionRank(c) < 2;
      if (filter === "injury") return c.injury.active;
      if (filter === "nocheck") return c.readinessScore === null;
      return true;
    });
  }, [ranked, query, filter]);

  const selected = useMemo(
    () => cards.find((c) => c.athleteId === selectedId) ?? null,
    [cards, selectedId]
  );

  const nav = coachNav(user?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  const subtitle =
    cards.length === 0
      ? "No athletes assigned"
      : `${cards.length} athlete${cards.length === 1 ? "" : "s"} · ${stats.attention} need attention`;

  return (
    <AppShell
      role="coach"
      title="Squad readiness"
      subtitle={subtitle}
      userName={user?.name}
      nav={nav}
      activeKey="overview"
      onNavigate={navigate}
      onSignOut={logout}
      headerActions={
        <div className="flex items-center gap-2">
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            aria-label="Date"
            className="field h-9 w-[8.5rem] text-xs"
          />
          <Link href="/coach/athletes/new" className="btn-ghost h-9 px-3 text-xs" aria-label="Add athlete">
            + Add
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        {/* KPI strip — what happened today */}
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Athletes" value={cards.length} />
          <Kpi label="Present" value={stats.present} />
          <Kpi label="Sessions done" value={stats.completed} />
          <Kpi
            label="Avg readiness"
            value={dash(stats.avgReadiness)}
            band={stats.avgReadiness === null ? undefined : bandFor(stats.avgReadiness)}
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
        ) : null}

        {loading ? (
          <>
            <div className="surface-card h-60 animate-pulse" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="surface-card h-44 animate-pulse" />
              ))}
            </div>
          </>
        ) : cards.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">No athletes on your squad yet.</p>
            <Link href="/coach/athletes/new" className="btn-primary mt-3 inline-flex">
              Add your first athlete
            </Link>
          </Card>
        ) : (
          <>
            {/* What needs attention — triage first */}
            {attentionCards.length > 0 ? (
              <AttentionStrip cards={attentionCards} onSelect={setSelectedId} />
            ) : null}

            {/* Athlete messages needing a reply — surfaced, not buried */}
            <CoachNotesInbox />

            {/* What's the trend — squad analytics */}
            <SquadTrendPanel />

            {/* The squad — compact, searchable roster; tap a row for detail */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="label">Full roster</p>
                <span className="nums text-[10px] text-ink-faint">
                  {filtered.length} of {cards.length}
                </span>
              </div>

              <div className="mb-3 space-y-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                    <Icon.search />
                  </span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, sport, position…"
                    aria-label="Search athletes"
                    className="field pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROSTER_FILTERS.map((f) => {
                    const active = filter === f.key;
                    const count =
                      f.key === "attention"
                        ? stats.attention
                        : f.key === "injury"
                        ? cards.filter((c) => c.injury.active).length
                        : f.key === "nocheck"
                        ? cards.filter((c) => c.readinessScore === null).length
                        : 0;
                    return (
                      <button
                        key={f.key}
                        onClick={() => setFilter(f.key)}
                        aria-pressed={active}
                        className={`chip transition ${
                          active
                            ? "bg-accent text-accent-ink"
                            : "border border-line text-ink-muted hover:text-ink"
                        }`}
                      >
                        {f.label}
                        {f.key !== "all" && count > 0 ? ` ${count}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {filtered.length === 0 ? (
                <Card>
                  <p className="text-sm text-ink-muted">No athletes match your search or filter.</p>
                </Card>
              ) : (
                <div className="grid gap-2">
                  {filtered.map((c) => (
                    <RosterRow
                      key={c.athleteId}
                      card={c}
                      flagged={attentionRank(c) < 2}
                      onSelect={() => setSelectedId(c.athleteId)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <AthleteDetailSheet card={selected} date={date} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}

type RosterFilter = "all" | "attention" | "injury" | "nocheck";

const ROSTER_FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Attention" },
  { key: "injury", label: "Injury" },
  { key: "nocheck", label: "No check-in" },
];

/** Short, human reason an athlete is flagged — mirrors attentionRank's order. */
function attentionReason(c: DailyCard): string {
  if (c.rpe?.riskFlag === "red") return "High RPM risk";
  if (c.injury.active) return c.injury.bodyPart ? `Injury · ${c.injury.bodyPart}` : "Injury";
  if (c.readinessScore !== null && c.readinessScore < 60) return `Low readiness ${c.readinessScore}`;
  if (c.rpe?.riskFlag === "amber") return "RPM caution";
  if (c.readinessScore !== null && c.readinessScore < 80) return `Readiness ${c.readinessScore}`;
  return "Check in";
}

/** Compact triage row — one pill per flagged athlete, opening its detail sheet. */
function AttentionStrip({
  cards,
  onSelect,
}: {
  cards: DailyCard[];
  onSelect: (athleteId: string) => void;
}) {
  return (
    <div className="surface-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="chip chip-bad">
          <Icon.pulse /> Needs attention · {cards.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {cards.map((c) => {
          const band = bandFor(c.readinessScore);
          const dot = band === "red" ? "bg-bad" : band === "amber" ? "bg-warn" : "bg-ok";
          return (
            <button
              key={c.athleteId}
              onClick={() => onSelect(c.athleteId)}
              className="group flex items-center gap-2 rounded-full border border-line bg-surface-inset px-3 py-1.5 transition hover:border-accent/40"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="text-xs font-semibold text-ink">{c.name}</span>
              <span className="text-[11px] text-ink-muted">{attentionReason(c)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ label, value, band }: { label: string; value: number | string; band?: "green" | "amber" | "red" }) {
  const color = band === "green" ? "text-ok" : band === "amber" ? "text-warn" : band === "red" ? "text-bad" : "text-ink";
  return (
    <div className="surface-card p-3">
      <p className="label">{label}</p>
      <p className={`nums mt-1 font-display text-2xl font-bold leading-none ${color}`}>{value}</p>
    </div>
  );
}

/** Small green/amber/red readiness badge — the row's at-a-glance status. */
function ScoreDot({ score }: { score: number | null }) {
  const band = bandFor(score);
  const text = band === "red" ? "text-bad" : band === "amber" ? "text-warn" : "text-ok";
  const ring = band === "red" ? "border-bad/40" : band === "amber" ? "border-warn/40" : "border-ok/40";
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${ring}`}>
      <span className={`nums font-display text-sm font-bold ${text}`}>{score ?? "—"}</span>
    </span>
  );
}

/** Compact one-line roster entry. Whole row is tappable → opens the detail sheet. */
function RosterRow({
  card,
  flagged,
  onSelect,
}: {
  card: DailyCard;
  flagged: boolean;
  onSelect: () => void;
}) {
  const edge =
    flagged && card.rpe?.riskFlag === "red"
      ? "ring-1 ring-bad/30"
      : flagged
      ? "ring-1 ring-warn/30"
      : "";
  return (
    <button
      onClick={onSelect}
      className={`surface-card flex w-full items-center gap-3 p-3 text-left transition hover:border-accent/40 ${edge}`}
    >
      <ScoreDot score={card.readinessScore} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-display text-sm font-semibold text-ink">{card.name}</span>
          {card.injury.active ? <Chip band="red">injury</Chip> : null}
          {card.rpe ? <Chip band={card.rpe.riskFlag}>{card.rpe.riskFlag}</Chip> : null}
        </div>
        <p className="truncate text-[11px] text-ink-muted">
          {dash(card.sport)}
          {card.position ? ` · ${card.position}` : ""} · {dash(card.attendance.status)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {card.rpe ? (
          <>
            <span className="nums block font-display text-base font-bold leading-none text-ink">
              {card.rpe.calculatedTrainingLoad}
            </span>
            <span className="text-[10px] text-ink-faint">load</span>
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">no rpe</span>
        )}
      </div>
      <span className="shrink-0 text-ink-faint">
        <Icon.chevron />
      </span>
    </button>
  );
}

/** Bottom-sheet wrapper — mounts the heavy detail body only while an athlete is selected. */
function AthleteDetailSheet({
  card,
  date,
  onClose,
}: {
  card: DailyCard | null;
  date: string;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={!!card}
      onClose={onClose}
      title={
        card ? (
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold text-ink">{card.name}</p>
            <p className="truncate text-[11px] text-ink-muted">
              {dash(card.sport)}
              {card.position ? ` · ${card.position}` : ""}
            </p>
          </div>
        ) : null
      }
    >
      {card ? <AthleteDetail card={card} date={date} /> : null}
    </BottomSheet>
  );
}

/** The rich per-athlete view that used to live inline in every card. Because it
 *  renders only inside an open sheet, MiniTrend's per-athlete trend fetch and the
 *  comment composer are lazy — no longer one request per roster row on load. */
function AthleteDetail({ card, date }: { card: DailyCard; date: string }) {
  const band = bandFor(card.readinessScore);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Ring value={card.readinessScore} size={72} stroke={8} band={band} animate={false} />
        <div className="min-w-0 flex-1">
          <p className="label mb-1">Readiness</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip border border-line text-ink-muted">{dash(card.attendance.status)}</span>
            {card.injury.active ? (
              <Chip band="red">injury{card.injury.bodyPart ? ` · ${card.injury.bodyPart}` : ""}</Chip>
            ) : null}
          </div>
          <Link
            href={`/coach/athletes/${card.athleteId}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent-strong"
          >
            Open full profile <Icon.chevron />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {SESSION_SLOTS.map((slot) => (
          <StatTile
            key={slot}
            label={SLOT_LABEL[slot]}
            value={dash(card.sessions[slot].status)}
            sub={card.sessions[slot].type ?? undefined}
          />
        ))}
      </div>
      <p className="text-[11px] text-ink-muted">
        Soreness <span className="nums font-semibold text-ink">{wellnessTen(card.soreness)}/10</span>
        <span className="text-ink-faint"> · sleep {wellnessTen(card.sleep.quality)}/10</span>
      </p>

      <div className="border-t border-line pt-3">
        {card.rpe ? (
          <div>
            <div className="flex items-center gap-2">
              <Chip band={card.rpe.riskFlag}>{card.rpe.riskFlag}</Chip>
              <span className="nums font-display text-lg font-bold text-ink">{card.rpe.calculatedTrainingLoad}</span>
              <span className="ml-auto text-[11px] text-ink-faint">
                RPM {card.rpe.rpe} · {SLOT_LABEL[card.rpe.sessionType]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">{card.rpe.trainingCategory}</p>
            {card.rpe.riskReasons && card.rpe.riskReasons.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                {card.rpe.riskReasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">No RPM today</p>
        )}
      </div>

      <MiniTrend athleteId={card.athleteId} />

      <CommentComposer athleteId={card.athleteId} date={date} />
    </div>
  );
}

function MiniTrend({ athleteId }: { athleteId: string }) {
  const [series, setSeries] = useState<TrendPoint[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/coach/athletes/${athleteId}/trends?days=7`);
        if (!res.ok) return;
        const json = (await res.json()) as { series?: TrendPoint[] };
        if (!cancelled) setSeries(json.series ?? []);
      } catch {
        /* trend is non-critical — fail quiet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (!series || series.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <TrendRow label="Load" series={series} />
    </div>
  );
}

function CommentComposer({ athleteId, date }: { athleteId: string; date: string }) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function send() {
    const text = body.trim();
    if (!text) return;
    setStatus("saving");
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/comment`, {
        method: "POST",
        body: JSON.stringify({ date, body: text }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setBody("");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (status !== "idle") setStatus("idle");
        }}
        placeholder="Recommend an adjustment…"
        className="field h-14 resize-none py-2 text-xs"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={send} disabled={status === "saving" || !body.trim()} className="btn-primary h-8 px-3 text-xs">
          {status === "saving" ? "Sending…" : "Send feedback"}
        </button>
        {status === "saved" ? <span className="text-[11px] text-ok">Sent.</span> : null}
        {status === "error" ? <span className="text-[11px] text-bad">Could not send.</span> : null}
      </div>
    </div>
  );
}
