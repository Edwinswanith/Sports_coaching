"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../components/Card";
import { Ring, bandFor } from "../../../components/Ring";
import { Chip, StatTile, dash, Icon } from "../../../components/ui";
import { AppShell, type NavItem } from "../../../components/AppShell";
import { PerformanceTrendPanel, WellnessTrendPanel } from "../../../components/charts/panels";
import { ChartTabs } from "../../../components/charts/ChartTabs";
import { Timeline, type FeedItem } from "../../../components/Timeline";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../lib/api";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../../lib/sessions";

type AthleteSummary = { athleteId: string; name: string; sport: string; position: string | null };

type DailyCard = {
  athleteId: string;
  name: string;
  attendance: { status: string | null };
  sessions: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  recovery: { status: string | null; score: number | null };
  injury: { active: boolean; bodyPart: string | null; restriction: string | null };
  rpe: {
    sessionType: SessionSlot;
    rpe: number;
    calculatedTrainingLoad: number;
    riskFlag: "green" | "amber" | "red";
    riskReasons?: string[];
  } | null;
};

type CoachComment = { _id: string; body: string };

export default function GuardianDashboardPage() {
  const router = useRouter();
  const [section, setSection] = useState<"today" | "trends" | "feedback">("today");
  const [user, setUser] = useState<StoredUser | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<DailyCard | null>(null);
  const [comments, setComments] = useState<CoachComment[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(
    (status: number) => {
      if (isAuthFailure(status)) {
        clearSession();
        router.replace("/");
        return true;
      }
      return false;
    },
    [router]
  );

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/guardian/athletes");
        if (guard(res.status)) return;
        const json = (await res.json()) as { athletes?: AthleteSummary[] };
        if (cancelled) return;
        const list = json.athletes ?? [];
        setAthletes(list);
        setSelectedId((prev) => prev ?? list[0]?.athleteId ?? null);
      } catch {
        if (!cancelled) setError("Unable to load linked athletes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, guard]);

  useEffect(() => {
    if (!selectedId) {
      setCard(null);
      setComments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [cardRes, commentsRes, activityRes] = await Promise.all([
          apiFetch(`/api/guardian/athletes/${selectedId}/daily-card?date=${date}`),
          apiFetch(`/api/guardian/athletes/${selectedId}/coach-comments?date=${date}`),
          apiFetch(`/api/guardian/athletes/${selectedId}/activity?limit=30`),
        ]);
        if (guard(cardRes.status) || guard(commentsRes.status) || guard(activityRes.status))
          return;
        const cardJson = (await cardRes.json()) as { card?: DailyCard };
        const commentsJson = (await commentsRes.json()) as { comments?: CoachComment[] };
        const activityJson = (await activityRes.json()) as { items?: FeedItem[] };
        if (cancelled) return;
        setCard(cardJson.card ?? null);
        setComments(commentsJson.comments ?? []);
        setActivity(activityJson.items ?? []);
      } catch {
        if (!cancelled) setError("Unable to load athlete summary.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, date, guard]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const selectedName = athletes.find((a) => a.athleteId === selectedId)?.name;
  const band = bandFor(card?.readinessScore ?? null);

  const nav: NavItem[] = [
    { key: "today", label: "Today", icon: <Icon.home /> },
    { key: "trends", label: "Trends", icon: <Icon.chart /> },
    { key: "feedback", label: "Feedback", icon: <Icon.message />, badge: comments.length || undefined },
  ];

  return (
    <AppShell
      role="guardian"
      title={selectedName ?? "My athlete"}
      userName={user?.name}
      nav={nav}
      activeKey={section}
      onNavigate={(k) => setSection(k as typeof section)}
      onSignOut={logout}
      headerActions={
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          aria-label="Date"
          className="field h-9 w-[8.5rem] text-xs"
        />
      }
    >
      <div className="space-y-3">
        {error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
        ) : null}

        {/* Linked-athlete switcher — visible across sections when there's more than one. */}
        {athletes.length > 1 ? (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {athletes.map((a) => (
              <button
                key={a.athleteId}
                onClick={() => setSelectedId(a.athleteId)}
                className={`h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition ${
                  selectedId === a.athleteId
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line bg-surface-inset text-ink-muted hover:text-ink"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="surface-card h-40 animate-pulse" />
        ) : athletes.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">No linked athletes yet. Ask the academy to link your account.</p>
          </Card>
        ) : (
          <>
            {section === "today" ? (
              <div className="space-y-3 animate-rise">
                {card ? (
                  <>
                    {card.injury.active ? (
                      <div className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                        <Icon.shield />
                        <span>
                          {card.injury.bodyPart}
                          {card.injury.restriction ? ` — ${card.injury.restriction}` : ""}
                        </span>
                      </div>
                    ) : null}

                    <div className="hero-card p-5">
                      <div className="flex flex-col items-center text-center">
                        <Ring value={card.readinessScore} size={150} stroke={12} label="readiness" band={band} />
                        <p className="mt-3 max-w-xs text-xs text-ink-muted">
                          {card.readinessScore === null
                            ? "No check-in logged yet for this date."
                            : "Readiness indicator from today's check-in."}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <StatTile label="Sleep" value={dash(card.sleep.hours)} sub={`quality ${dash(card.sleep.quality)}/5`} icon={<Icon.moon />} />
                      <StatTile label="Recovery" value={dash(card.recovery.score)} sub={card.recovery.status ?? "no data"} icon={<Icon.pulse />} />
                    </div>

                    <Card title="Today's sessions">
                      <p className="mb-2 text-[11px] text-ink-muted">
                        Attendance <span className="font-semibold text-ink">{dash(card.attendance.status)}</span>
                      </p>
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

                      {card.rpe ? (
                        <div className="mt-3 border-t border-line pt-3">
                          <div className="flex items-center gap-2">
                            <Chip band={card.rpe.riskFlag}>{card.rpe.riskFlag}</Chip>
                            <span className="nums font-display text-lg font-bold text-ink">{card.rpe.calculatedTrainingLoad}</span>
                            <span className="ml-auto text-[11px] text-ink-faint">RPE {card.rpe.rpe} · {SLOT_LABEL[card.rpe.sessionType]}</span>
                          </div>
                          {card.rpe.riskReasons && card.rpe.riskReasons.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
                              {card.rpe.riskReasons.map((r, i) => (
                                <li key={i}>· {r}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  </>
                ) : (
                  <Card>
                    <p className="text-sm text-ink-muted">No data for this date.</p>
                  </Card>
                )}
              </div>
            ) : null}

            {section === "trends" ? (
              <div className="animate-rise">
                {selectedId ? (
                  <ChartTabs
                    tabs={[
                      { key: "readiness", label: "Readiness", node: <PerformanceTrendPanel base={`/api/guardian/athletes/${selectedId}`} /> },
                      { key: "wellness", label: "Wellness", node: <WellnessTrendPanel base={`/api/guardian/athletes/${selectedId}`} /> },
                    ]}
                  />
                ) : null}
              </div>
            ) : null}

            {section === "feedback" ? (
              <div className="space-y-3 animate-rise">
                <Card title="Coach feedback">
                  {comments.length === 0 ? (
                    <p className="text-xs text-ink-faint">No comments for this date.</p>
                  ) : (
                    <ul className="space-y-2">
                      {comments.map((c) => (
                        <li key={c._id} className="rounded-xl border-l-2 border-ink-faint bg-surface-inset px-3 py-2 text-sm text-ink">
                          {c.body}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Recent activity">
                  <Timeline items={activity} />
                </Card>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
