"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "../../../../components/Card";
import { Ring, bandFor } from "../../../../components/Ring";
import { Chip, StatTile, dash, Icon } from "../../../../components/ui";
import { AppShell } from "../../../../components/AppShell";
import { coachNav, coachNavigate } from "../../../../lib/coachNav";
import type { TrendPoint } from "../../../../components/Trend";
import {
  PerformanceTrendPanel,
  WellnessTrendPanel,
  PerformancePanel,
  HeartRatePanel,
} from "../../../../components/charts/panels";
import { ChartTabs } from "../../../../components/charts/ChartTabs";
import { Timeline, type FeedItem } from "../../../../components/Timeline";
import { TRAINING_CATEGORIES } from "../../../../lib/trainingCategories";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
} from "../../../../lib/api";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../../../lib/sessions";

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  date: string;
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

type RpeEntry = {
  _id: string;
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  calculatedTrainingLoad: number;
  fatigue: number;
  muscleSoreness: number;
  sleepQuality: number;
  moodMotivation: number;
  bodyConditionFeedback?: string | null;
  restingHeartRate?: number | null;
  riskFlag: "green" | "amber" | "red";
  riskReasons?: string[];
  readinessScore?: number;
  readinessBand?: "green" | "amber" | "red";
};

type PerfEntry = {
  _id: string;
  date: string;
  metric: string;
  value: number;
  unit: string;
  context?: string | null;
};

type Tab = "overview" | "training" | "rpe" | "performance" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "training", label: "Training" },
  { key: "rpe", label: "RPE" },
  { key: "performance", label: "Performance" },
  { key: "activity", label: "Activity" },
];

const ATTENDANCE_OPTIONS = ["present", "late", "absent", "excused"] as const;
const SESSION_STATUS_OPTIONS = ["planned", "in_progress", "completed", "skipped"] as const;

export default function CoachAthleteDetailPage() {
  const router = useRouter();
  const params = useParams<{ athleteId: string }>();
  const athleteId = params.athleteId;

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<Tab>("overview");
  const [card, setCard] = useState<DailyCard | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [rpe, setRpe] = useState<RpeEntry[]>([]);
  const [perf, setPerf] = useState<PerfEntry[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const loadAll = useCallback(
    async (d: string) => {
      setLoading(true);
      setError(null);
      try {
        const [cardRes, trendsRes, rpeRes, perfRes, activityRes] = await Promise.all([
          apiFetch(`/api/coach/athletes/${athleteId}/daily-card?date=${d}`),
          apiFetch(`/api/coach/athletes/${athleteId}/trends?days=7`),
          apiFetch(`/api/coach/athletes/${athleteId}/rpe-monitoring?date=${d}`),
          apiFetch(`/api/coach/athletes/${athleteId}/performance?limit=50`),
          apiFetch(`/api/coach/athletes/${athleteId}/activity?limit=40`),
        ]);
        if (
          guard(cardRes.status) ||
          guard(trendsRes.status) ||
          guard(rpeRes.status) ||
          guard(perfRes.status) ||
          guard(activityRes.status)
        )
          return;
        if (cardRes.status === 404) {
          setError("Athlete not found, or not assigned to you.");
          setCard(null);
          return;
        }
        const cardJson = (await cardRes.json()) as { card?: DailyCard };
        const trendsJson = (await trendsRes.json()) as { series?: TrendPoint[] };
        const rpeJson = (await rpeRes.json()) as { entries?: RpeEntry[] };
        const perfJson = (await perfRes.json()) as { entries?: PerfEntry[] };
        const activityJson = (await activityRes.json()) as { items?: FeedItem[] };
        setCard(cardJson.card ?? null);
        setTrends(trendsJson.series ?? []);
        setRpe(rpeJson.entries ?? []);
        setPerf(perfJson.entries ?? []);
        setActivity(activityJson.items ?? []);
      } catch {
        setError("Unable to load this athlete.");
      } finally {
        setLoading(false);
      }
    },
    [athleteId, guard]
  );

  useEffect(() => {
    if (!getStoredUser()) {
      router.replace("/");
      return;
    }
    if (athleteId) loadAll(date);
  }, [athleteId, date, router, loadAll]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  async function refresh() {
    await loadAll(date);
  }

  const band = bandFor(card?.readinessScore ?? null);

  const nav = coachNav(getStoredUser()?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  const subtitle = card ? `${card.sport || "—"}${card.position ? ` · ${card.position}` : ""}` : undefined;

  return (
    <AppShell
      role="coach"
      title={card?.name || (loading ? "…" : "Athlete")}
      subtitle={subtitle}
      nav={nav}
      activeKey="roster"
      onNavigate={navigate}
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
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/coach/athletes" className="btn-ghost gap-1">
            <Icon.arrowLeft /> Back to roster
          </Link>
        </div>

        {/* Detail sub-tabs */}
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setInfo(null);
              }}
              className={`h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition ${
                tab === t.key
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface-inset text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {error ? <Banner tone="bad">{error}</Banner> : null}
        {info ? <Banner tone="ok">{info}</Banner> : null}

        {loading ? (
          <div className="surface-card h-44 animate-pulse" />
        ) : !card ? (
          <Card>
            <p className="text-sm text-ink-muted">No data for this athlete.</p>
          </Card>
        ) : tab === "overview" ? (
          <Overview card={card} athleteId={athleteId} band={band} />
        ) : tab === "training" ? (
          <TrainingTab
            athleteId={athleteId}
            date={date}
            card={card}
            guard={guard}
            onSaved={(msg) => {
              setInfo(msg);
              refresh();
            }}
            onError={setError}
          />
        ) : tab === "rpe" ? (
          <RpeTab entries={rpe} />
        ) : tab === "performance" ? (
          <PerformanceTab
            athleteId={athleteId}
            date={date}
            entries={perf}
            guard={guard}
            onSaved={(msg) => {
              setInfo(msg);
              refresh();
            }}
            onError={setError}
          />
        ) : (
          <Card title="Recent activity">
            <Timeline items={activity} />
          </Card>
        )}

        {card && !loading ? (
          <FeedbackComposer athleteId={athleteId} date={date} guard={guard} />
        ) : null}
      </section>
    </AppShell>
  );
}

/* ---------------- Overview ---------------- */

function Overview({ card, athleteId, band }: { card: DailyCard; athleteId: string; band: "green" | "amber" | "red" }) {
  return (
    <div className="space-y-4">
      <div className="surface-card animate-rise p-4">
        <div className="flex items-center gap-4">
          <Ring value={card.readinessScore} band={band} label="Readiness" />
          <div className="flex-1 space-y-2">
            <p className="font-display text-base font-semibold text-ink">
              {card.sport || "—"}
              {card.position ? ` · ${card.position}` : ""}
            </p>
            <StatTile
              label="Sleep"
              value={dash(card.sleep.hours)}
              sub={`quality ${dash(card.sleep.quality)}/5`}
              icon={<Icon.moon />}
            />
            <StatTile
              label="Recovery"
              value={dash(card.recovery.score)}
              sub={card.recovery.status ?? "no data"}
              icon={<Icon.pulse />}
            />
          </div>
        </div>

        <p className="mt-3 text-[11px] text-ink-muted">
          Attendance <span className="font-semibold text-ink">{dash(card.attendance.status)}</span>
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SESSION_SLOTS.map((slot) => (
            <StatTile
              key={slot}
              label={SLOT_LABEL[slot]}
              value={dash(card.sessions[slot].status)}
              sub={card.sessions[slot].type ?? undefined}
            />
          ))}
        </div>

        {card.injury.active ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <Icon.shield />
            <span>
              {card.injury.bodyPart}
              {card.injury.severity ? ` · ${card.injury.severity}` : ""}
              {card.injury.restriction ? ` — ${card.injury.restriction}` : ""}
            </span>
          </div>
        ) : null}
      </div>

      <Card title="Training load" action={<Icon.flame />}>
        {card.rpe ? (
          <div>
            <div className="flex items-center gap-2">
              <Chip band={card.rpe.riskFlag}>{card.rpe.riskFlag}</Chip>
              <span className="nums font-display text-2xl font-bold text-ink">{card.rpe.calculatedTrainingLoad}</span>
              <span className="ml-auto text-[11px] text-ink-faint">
                RPE {card.rpe.rpe} · {SLOT_LABEL[card.rpe.sessionType]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {card.rpe.trainingCategory} · {card.rpe.plannedIntensityPercent}% intensity
            </p>
            {card.rpe.riskReasons && card.rpe.riskReasons.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
                {card.rpe.riskReasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-faint">No RPE logged for this date.</p>
        )}
      </Card>

      <ChartTabs
        tabs={[
          { key: "readiness", label: "Readiness", node: <PerformanceTrendPanel base={`/api/coach/athletes/${athleteId}`} /> },
          { key: "hr", label: "Heart rate", node: <HeartRatePanel base={`/api/coach/athletes/${athleteId}`} /> },
          { key: "wellness", label: "Wellness", node: <WellnessTrendPanel base={`/api/coach/athletes/${athleteId}`} /> },
          { key: "performance", label: "Performance", node: <PerformancePanel base={`/api/coach/athletes/${athleteId}`} /> },
        ]}
      />
    </div>
  );
}

/* ---------------- Training tab ---------------- */

type SlotForm = {
  status: string;
  type: string;
  durationMin: string;
  intensityRpe: string;
  notes: string;
};

function emptySlotForm(card: DailyCard, slot: SessionSlot): SlotForm {
  return {
    status: card.sessions[slot].status ?? "planned",
    type: card.sessions[slot].type ?? "",
    durationMin: "",
    intensityRpe: "",
    notes: "",
  };
}

function TrainingTab({
  athleteId,
  date,
  card,
  guard,
  onSaved,
  onError,
}: {
  athleteId: string;
  date: string;
  card: DailyCard;
  guard: (status: number) => boolean;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card title="Attendance">
        <AttendanceRecorder athleteId={athleteId} date={date} current={card.attendance.status} guard={guard} onSaved={onSaved} onError={onError} />
      </Card>
      {SESSION_SLOTS.map((slot) => (
        <SlotEditor key={slot} slot={slot} athleteId={athleteId} date={date} card={card} guard={guard} onSaved={onSaved} onError={onError} />
      ))}
    </div>
  );
}

function AttendanceRecorder({
  athleteId,
  date,
  current,
  guard,
  onSaved,
  onError,
}: {
  athleteId: string;
  date: string;
  current: string | null;
  guard: (status: number) => boolean;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function set(status: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ date, status }),
      });
      if (guard(res.status)) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        onError(j.error ?? "Could not save attendance.");
        return;
      }
      onSaved(`Attendance: ${status}.`);
    } catch {
      onError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {ATTENDANCE_OPTIONS.map((o) => (
        <button
          key={o}
          disabled={busy}
          onClick={() => set(o)}
          className={`h-10 rounded-xl border text-xs font-semibold capitalize transition disabled:opacity-50 ${
            current === o
              ? "border-accent bg-accent text-accent-ink"
              : "border-line bg-surface-inset text-ink-muted hover:text-ink"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SlotEditor({
  slot,
  athleteId,
  date,
  card,
  guard,
  onSaved,
  onError,
}: {
  slot: SessionSlot;
  athleteId: string;
  date: string;
  card: DailyCard;
  guard: (status: number) => boolean;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const slotLabel = SLOT_LABEL[slot];
  const [form, setForm] = useState<SlotForm>(() => emptySlotForm(card, slot));
  const [busy, setBusy] = useState(false);

  // Re-sync when the card (date) changes.
  useEffect(() => {
    setForm(emptySlotForm(card, slot));
  }, [card, slot]);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { date, status: form.status };
      if (form.type.trim()) body.type = form.type.trim();
      if (form.durationMin.trim()) body.durationMin = Number(form.durationMin);
      if (form.intensityRpe.trim()) body.intensityRpe = Number(form.intensityRpe);
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await apiFetch(`/api/coach/athletes/${athleteId}/training/${slot}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (guard(res.status)) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        onError(j.error ?? "Could not save session.");
        return;
      }
      onSaved(`${slotLabel} session saved.`);
    } catch {
      onError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`${slotLabel} session`}>
      <div className="grid gap-3">
        <label className="block">
          <span className="label">Category / type</span>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className="field mt-1.5"
          >
            <option value="">Rest / unset</option>
            {TRAINING_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            className="field mt-1.5 capitalize"
          >
            {SESSION_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Duration (min)</span>
          <input
            value={form.durationMin}
            onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
            type="number"
            min={0}
            placeholder="e.g. 90"
            className="field mt-1.5 nums"
          />
        </label>
        <label className="block">
          <span className="label">Intensity RPE (1–10)</span>
          <input
            value={form.intensityRpe}
            onChange={(e) => setForm((f) => ({ ...f, intensityRpe: e.target.value }))}
            type="number"
            min={1}
            max={10}
            placeholder="optional"
            className="field mt-1.5 nums"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="label">Notes</span>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="field mt-1.5 h-16 resize-none py-2"
          placeholder="Plan detail or coaching note…"
        />
      </label>
      <button onClick={save} disabled={busy} className="btn-primary mt-3 w-full">
        {busy ? "Saving…" : `Save ${slotLabel} session`}
      </button>
    </Card>
  );
}

/* ---------------- RPE tab ---------------- */

function RpeTab({ entries }: { entries: RpeEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">No RPE entries for this date.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {entries.map((e) => (
        <Card key={e._id} title={`${SLOT_LABEL[e.sessionType]} · ${e.trainingCategory}`}>
          <div className="flex items-center gap-2">
            <Chip band={e.riskFlag}>{e.riskFlag}</Chip>
            <span className="nums font-display text-2xl font-bold text-ink">{e.calculatedTrainingLoad}</span>
            <span className="ml-auto text-[11px] text-ink-faint">
              RPE {e.rpe} · {e.plannedIntensityPercent}%
            </span>
          </div>

          {e.readinessBand && typeof e.readinessScore === "number" ? (
            <div className="mt-3 flex items-center gap-2">
              <Chip band={e.readinessBand}>Readiness {e.readinessScore}</Chip>
              <span className="text-[11px] text-ink-muted">
                {e.readinessBand === "green" ? "Ready to train" : e.readinessBand === "amber" ? "Reduced capacity" : "Recovery needed"}
              </span>
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-4 gap-2">
            <StatTile label="Sleep" value={`${e.sleepQuality}/5`} />
            <StatTile label="Soreness" value={`${e.muscleSoreness}/5`} />
            <StatTile label="Fatigue" value={`${e.fatigue}/5`} />
            <StatTile label="Mood" value={`${e.moodMotivation}/5`} />
          </div>

          {typeof e.restingHeartRate === "number" ? (
            <p className="mt-2 text-[11px] text-ink-muted">Resting HR {e.restingHeartRate} bpm</p>
          ) : null}

          {e.bodyConditionFeedback ? (
            <p className="mt-2 rounded-xl border-l-2 border-ink-faint bg-surface-inset px-3 py-2 text-sm text-ink">
              {e.bodyConditionFeedback}
            </p>
          ) : null}

          {e.riskReasons && e.riskReasons.length > 0 ? (
            <div className="mt-3">
              <p className="label">Why this flag</p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {e.riskReasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

/* ---------------- Performance tab ---------------- */

function PerformanceTab({
  athleteId,
  date,
  entries,
  guard,
  onSaved,
  onError,
}: {
  athleteId: string;
  date: string;
  entries: PerfEntry[];
  guard: (status: number) => boolean;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({ metric: "", value: "", unit: "", context: "" });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!form.metric.trim() || !form.value.trim() || !form.unit.trim()) {
      onError("Metric, value and unit are required.");
      return;
    }
    const value = Number(form.value);
    if (Number.isNaN(value)) {
      onError("Value must be a number.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/performance`, {
        method: "POST",
        body: JSON.stringify({
          date,
          metric: form.metric.trim(),
          value,
          unit: form.unit.trim(),
          context: form.context.trim() || undefined,
        }),
      });
      if (guard(res.status)) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        onError(j.error ?? "Could not save result.");
        return;
      }
      setForm({ metric: "", value: "", unit: "", context: "" });
      onSaved("Performance result added.");
    } catch {
      onError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Add result" action={<Icon.trophy />}>
        <div className="grid gap-3">
          <label className="block sm:col-span-3">
            <span className="label">Metric</span>
            <input
              value={form.metric}
              onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              placeholder="e.g. 100m sprint"
              className="field mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label">Value</span>
            <input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              type="number"
              step="any"
              placeholder="e.g. 11.2"
              className="field mt-1.5 nums"
            />
          </label>
          <label className="block">
            <span className="label">Unit</span>
            <input
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder="s, kg, m…"
              className="field mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label">Context</span>
            <input
              value={form.context}
              onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))}
              placeholder="optional"
              className="field mt-1.5"
            />
          </label>
        </div>
        <button onClick={add} disabled={busy} className="btn-primary mt-3 w-full">
          {busy ? "Saving…" : "Add result"}
        </button>
      </Card>

      <Card title={`History · ${entries.length}`}>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-muted">No performance results yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-inset px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{p.metric}</span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {p.date.slice(0, 10)}
                    {p.context ? ` · ${p.context}` : ""}
                  </span>
                </span>
                <span className="nums shrink-0 font-display text-lg font-bold text-accent-strong">
                  {p.value}
                  <span className="ml-1 text-[11px] font-semibold text-ink-faint">{p.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Feedback ---------------- */

function FeedbackComposer({
  athleteId,
  date,
  guard,
}: {
  athleteId: string;
  date: string;
  guard: (status: number) => boolean;
}) {
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
      if (guard(res.status)) return;
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
    <Card title="Send feedback">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (status !== "idle") setStatus("idle");
        }}
        placeholder="Recommend an adjustment for this athlete…"
        className="field h-16 resize-none py-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={send} disabled={status === "saving" || !body.trim()} className="btn-primary h-9 px-3 text-xs">
          {status === "saving" ? "Sending…" : "Send feedback"}
        </button>
        {status === "saved" ? <span className="text-[11px] text-ok">Sent.</span> : null}
        {status === "error" ? <span className="text-[11px] text-bad">Could not send.</span> : null}
      </div>
    </Card>
  );
}

function Banner({ tone, children }: { tone: "ok" | "bad"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-bad/30 bg-bad/10 text-bad";
  return <div className={`rounded-xl border px-3 py-2.5 text-sm ${cls}`}>{children}</div>;
}
