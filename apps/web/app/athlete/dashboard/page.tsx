"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../components/Card";
import { AuthImage } from "../../../components/AuthImage";
import { Ring, bandFor } from "../../../components/Ring";
import { Chip, StatTile, dash, Icon, CompactDatePicker } from "../../../components/ui";
import { AppShell } from "../../../components/AppShell";
import { ProfileMenu } from "../../../components/ProfileMenu";
import { athleteNav, isAthleteSection } from "../../../lib/athleteNav";
import {
  PerformanceTrendPanel,
  WellnessTrendPanel,
  PerformancePanel,
  HeartRatePanel,
} from "../../../components/charts/panels";
import { HydrationModule } from "../../../components/WaterCard";
import { QuickCheckIn } from "../../../components/QuickCheckIn";
import { ChartTabs } from "../../../components/charts/ChartTabs";
import { Timeline, type FeedItem } from "../../../components/Timeline";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
} from "../../../lib/api";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../../lib/sessions";
import { TRAINING_CATEGORIES } from "../../../lib/trainingCategories";
import {
  wellnessFiveToTen,
  submitWellnessAction,
  submitAttendanceAction,
  submitRestDayAction,
  submitTrainingAction,
  submitRpeMonitoringAction,
  submitRecoveryAction,
} from "../../../lib/athleteActions";
import { VoiceAssistantSheet } from "../../../components/VoiceAssistant/VoiceAssistantSheet";
import { useSpeechRecognition } from "../../../components/VoiceAssistant/useSpeechRecognition";

type DailySession = {
  status: string | null;
  type: string | null;
  durationMin?: number | null;
  intensityRpe?: number | null;
  attended?: boolean | null;
  workoutType?: string | null;
  sets?: number | null;
  reps?: string | null;
  actualDurationMin?: number | null;
  effortRating?: number | null;
  notes?: string | null;
};

type DailyCardData = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  date: string;
  isRestDay?: boolean;
  attendance: { status: string | null; note: string | null };
  sessions: Record<SessionSlot, DailySession>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  heartRate: { wakeHr: number | null; bedHr: number | null };
  recovery: { status: string | null; score: number | null; restingHr: number | null; hrv: number | null };
  injury: { active: boolean; bodyPart: string | null; severity: string | null; restriction: string | null };
  rpe?: RpeEntry | null;
  rpeEntries?: Record<SessionSlot, RpeEntry | null>;
};

type StoredUser = {
  name: string;
  email: string;
  role: string;
  avatar?: { kind: "photo" | "default" | null; defaultId: string | null };
};
type CoachComment = { _id: string; body: string; date: string; createdAt: string; coachId: string };
type TeamAnnouncement = { id: string; body: string; coachName: string; createdAt: string };
type TeamAnnouncementResponse = { announcements?: TeamAnnouncement[]; coachCount?: number };
type AchievementTone = "green" | "amber" | "red";
type AchievementGoal = {
  key: "check_in" | "training" | "hydration" | "all_rounder";
  title: string;
  description: string;
  metricLabel: string;
  target: number;
  currentStreak: number;
  completedDays: number;
  longestStreak: number;
  progress: number;
  achieved: boolean;
  tone: AchievementTone;
  reward: {
    title: string;
    description: string;
    badgeLabel: string;
    unlocked: boolean;
  };
  history: { date: string; met: boolean }[];
};
type AchievementsResponse = {
  days: number;
  generatedAt: string;
  summary: {
    unlocked: number;
    nextGoal: { key: AchievementGoal["key"]; title: string; remaining: number } | null;
    bestStreak: { key: AchievementGoal["key"]; title: string; days: number } | null;
  };
  goals: AchievementGoal[];
};
type RpeEntry = {
  _id?: string;
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  calculatedTrainingLoad: number;
  riskFlag: "green" | "amber" | "red";
  riskReasons?: string[];
  readinessScore?: number;
  readinessBand?: "green" | "amber" | "red";
  restingHeartRate?: number;
  sleepQuality?: number;
  muscleSoreness?: number;
  fatigue?: number;
  moodMotivation?: number;
};

type WellnessForm = {
  sleepHours: string;
  sleepQuality: string;
  mood: string;
  stress: string;
  soreness: string;
  fatigue: string;
};

type Section = "today" | "progress" | "log" | "coach";
type ProgressTab = "goals" | "water" | "trends";

const emptyWellness: WellnessForm = {
  sleepHours: "",
  sleepQuality: "5",
  mood: "5",
  stress: "5",
  soreness: "5",
  fatigue: "5",
};

const ATTENDANCE_OPTIONS: { value: "present" | "late" | "absent"; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
];

const TRAINING_OPTIONS: { value: "completed" | "in_progress" | "skipped" | "rest"; label: string }[] = [
  { value: "completed", label: "Done" },
  { value: "in_progress", label: "Partial" },
  { value: "skipped", label: "Missed" },
  { value: "rest", label: "Rest" },
];
type SessionStatusValue = (typeof TRAINING_OPTIONS)[number]["value"];

const WORKOUT_TYPES = TRAINING_CATEGORIES;
const CATEGORY_CHOICES = TRAINING_CATEGORIES;

const RECOVERY_OPTIONS = [
  { value: "stretching", label: "Stretching" },
  { value: "ice_bath", label: "Ice bath" },
  { value: "mobility", label: "Mobility" },
  { value: "physio", label: "Physio" },
  { value: "hydration", label: "Hydration" },
];

const WELLNESS_SLIDERS: { key: keyof WellnessForm; label: string; lo: string; hi: string; invert?: boolean }[] = [
  { key: "sleepQuality", label: "Sleep quality", lo: "Poor", hi: "Great" },
  { key: "mood", label: "Mood", lo: "Low", hi: "High" },
  { key: "stress", label: "Stress", lo: "Calm", hi: "Tense", invert: true },
  { key: "soreness", label: "Soreness", lo: "Fresh", hi: "Sore", invert: true },
  { key: "fatigue", label: "Fatigue", lo: "Rested", hi: "Spent", invert: true },
];

function wellnessFiveToTenStr(value: number | null | undefined): string {
  return String(wellnessFiveToTen(value));
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Safe, non-diagnostic readiness-indicator guidance shown under the hero ring. */
function readinessGuidance(score: number | null): { word: string; line: string } {
  if (score === null) return { word: "No check-in", line: "Log today's check-in to see your readiness indicator." };
  const band = bandFor(score);
  if (band === "green") return { word: "Ready", line: "Readiness indicator looks strong — cleared for full training." };
  if (band === "amber") return { word: "Caution", line: "Moderate readiness — manage load and listen to your body." };
  return { word: "Recover", line: "Low readiness indicator — prioritise recovery and tell your coach." };
}

export default function AthleteDashboardPage() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("today");
  const [progressTab, setProgressTab] = useState<ProgressTab>("goals");
  // Restore the section when returning from a routed tab (e.g. Chat → Coach).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s && isAthleteSection(s)) setSection(s);
  }, []);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [user, setUser] = useState<StoredUser | null>(null);
  const [card, setCard] = useState<DailyCardData | null>(null);
  const [wellness, setWellness] = useState<WellnessForm>(emptyWellness);
  const [recoveryModalities, setRecoveryModalities] = useState<string[]>([]);
  const [hrForm, setHrForm] = useState({ wakeHr: "", bedHr: "" });
  const [coachComments, setCoachComments] = useState<CoachComment[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [coachCount, setCoachCount] = useState<number | null>(null);
  const [rpeEntries, setRpeEntries] = useState<RpeEntry[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [logFocusSlot, setLogFocusSlot] = useState<SessionSlot | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  const handleAuthFailure = useCallback(
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
        const [cardRes, commentsRes, rpeRes, activityRes, annRes, achievementsRes] = await Promise.all([
          apiFetch(`/api/athlete/daily?date=${d}`),
          apiFetch(`/api/athlete/coach-comments?date=${d}`),
          apiFetch(`/api/athlete/rpe-monitoring?date=${d}`),
          apiFetch(`/api/athlete/activity?limit=30`),
          apiFetch(`/api/athlete/announcements`),
          apiFetch(`/api/athlete/achievements?days=60`),
        ]);
        if (
          handleAuthFailure(cardRes.status) ||
          handleAuthFailure(commentsRes.status) ||
          handleAuthFailure(rpeRes.status) ||
          handleAuthFailure(activityRes.status) ||
          handleAuthFailure(annRes.status) ||
          handleAuthFailure(achievementsRes.status)
        )
          return;
        const cardJson = (await cardRes.json()) as { card?: DailyCardData };
        const commentsJson = (await commentsRes.json()) as { comments?: CoachComment[] };
        const rpeJson = (await rpeRes.json()) as { entries?: RpeEntry[] };
        const activityJson = (await activityRes.json()) as { items?: FeedItem[] };
        const annJson = annRes.ok
          ? ((await annRes.json()) as TeamAnnouncementResponse)
          : { announcements: [], coachCount: 0 };
        const achievementsJson = achievementsRes.ok
          ? ((await achievementsRes.json()) as AchievementsResponse)
          : null;
        setCard(cardJson.card ?? null);
        setCoachComments(commentsJson.comments ?? []);
        setAnnouncements(annJson.announcements ?? []);
        setCoachCount(annJson.coachCount ?? null);
        setRpeEntries(rpeJson.entries ?? []);
        setActivity(activityJson.items ?? []);
        setAchievements(achievementsJson);
        const todays = cardJson.card;
        setWellness({
          sleepHours: todays?.sleep.hours?.toString() ?? "",
          sleepQuality: wellnessFiveToTenStr(todays?.sleep.quality),
          mood: "5",
          stress: "5",
          soreness: wellnessFiveToTenStr(todays?.soreness),
          fatigue: "5",
        });
        setHrForm({
          wakeHr: todays?.heartRate.wakeHr?.toString() ?? "",
          bedHr: todays?.heartRate.bedHr?.toString() ?? "",
        });
        setRecoveryModalities([]);
      } catch {
        setError("Unable to load your day.");
      } finally {
        setLoading(false);
      }
    },
    [handleAuthFailure]
  );

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      router.replace("/");
      return;
    }
    setUser(storedUser as StoredUser);
    loadAll(date);
  }, [date, router, loadAll]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  /** Post-fetch handling shared by every write path (manual forms and the voice assistant). */
  async function handleActionResponse(res: Response): Promise<boolean> {
    if (handleAuthFailure(res.status)) return false;
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Save failed.");
      return false;
    }
    return true;
  }

  /** Runs a write action (an athleteActions.ts call), clearing/settings info+error consistently. */
  async function runAction(fn: () => Promise<Response>): Promise<boolean> {
    setInfo(null);
    try {
      const res = await fn();
      return await handleActionResponse(res);
    } catch {
      setError("Network error.");
      return false;
    }
  }

  async function postJson(path: string, body: unknown): Promise<boolean> {
    return runAction(() => apiFetch(path, { method: "POST", body: JSON.stringify(body) }));
  }

  async function refresh() {
    await loadAll(date);
  }

  async function submitWellness() {
    if (
      await runAction(() =>
        submitWellnessAction({
          date,
          sleepHours: wellness.sleepHours ? Number(wellness.sleepHours) : undefined,
          sleepQuality: wellness.sleepQuality,
          mood: wellness.mood,
          stress: wellness.stress,
          soreness: wellness.soreness,
          fatigue: wellness.fatigue,
        })
      )
    ) {
      setInfo("Check-in saved.");
      await refresh();
    }
  }

  async function submitAttendance(status: "present" | "late" | "absent") {
    if (await runAction(() => submitAttendanceAction(date, status))) {
      setInfo(`Attendance: ${status}.`);
      await refresh();
    }
  }

  async function submitTraining(slot: SessionSlot, status: "completed" | "in_progress" | "skipped" | "rest") {
    if (await runAction(() => submitTrainingAction(date, slot, { status }))) {
      setInfo(`${slot} session: ${status}.`);
      await refresh();
    }
  }

  function toggleModality(value: string) {
    setRecoveryModalities((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function submitRecovery() {
    if (await runAction(() => submitRecoveryAction(date, recoveryModalities))) {
      setInfo("Recovery saved.");
      await refresh();
    }
  }

  async function submitHeartRate() {
    const payload: Record<string, number> = {};
    for (const [key, raw] of [["wakeHr", hrForm.wakeHr], ["bedHr", hrForm.bedHr]] as const) {
      if (!raw.trim()) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 25 || n > 220) {
        setInfo("Heart rate must be between 25 and 220 bpm.");
        return;
      }
      payload[key] = n;
    }
    if (Object.keys(payload).length === 0) {
      // Heart rate is optional — leaving it blank (e.g. in Quick check-in) is
      // a normal skip, not an error worth surfacing.
      return;
    }
    if (await postJson("/api/athlete/heart-rate", { date, ...payload })) {
      setInfo("Heart rate saved.");
      await refresh();
    }
  }

  const latestRpe = rpeEntries[rpeEntries.length - 1];
  const readiness = card?.readinessScore ?? null;
  const guidance = readinessGuidance(readiness);
  const band = bandFor(readiness);

  const nav = athleteNav({ coachCount, coachBadge: coachComments.length });
  const greetingInitials = initialsOf(user?.name ?? "");

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceCoachId, setVoiceCoachId] = useState<string | null>(null);
  const speechSupport = useSpeechRecognition();

  useEffect(() => {
    if (!voiceOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/athlete/coaches");
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { coaches?: { coachId: string; name: string }[] };
        if (json.coaches?.length === 1) setVoiceCoachId(json.coaches[0].coachId);
      } catch {
        /* voice coach messaging just stays unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceOpen]);

  function handleVoiceNavigate(target: string) {
    if (target === "messages") {
      router.push("/athlete/messages");
      return;
    }
    if (target === "today" || target === "progress" || target === "log" || target === "coach") {
      setSection(target);
      return;
    }
    if (target === "water" || target === "goals" || target === "trends") {
      setSection("progress");
      setProgressTab(target);
    }
  }

  async function getVoiceStatusSummary(topic: string): Promise<string> {
    if (topic === "hydration") {
      try {
        const res = await apiFetch(`/api/athlete/water?date=${date}`);
        if (res.ok) {
          const day = (await res.json()) as { totalMl: number; goalMl: number };
          const remaining = Math.max(0, day.goalMl - day.totalMl);
          return remaining <= 0
            ? `You've hit your hydration goal of ${day.goalMl} millilitres today.`
            : `You've had ${day.totalMl} of your ${day.goalMl} millilitre goal — ${remaining} millilitres remaining.`;
        }
      } catch {
        /* fall through to the error message below */
      }
      return "I couldn't load your hydration data.";
    }
    if (topic === "training_plan") {
      if (!card) return "No training plan loaded for today.";
      return SESSION_SLOTS.map((slot) => {
        const s = card.sessions[slot];
        const label = s.workoutType || s.type || "no plan";
        return `${SLOT_LABEL[slot]}: ${label}${s.status ? ` — ${s.status}` : ""}`;
      }).join(". ");
    }
    if (topic === "coach_feedback") {
      if (coachComments.length === 0) return "No coach feedback for today yet.";
      return coachComments.map((c) => c.body).join(". ");
    }
    // readiness or general
    if (readiness == null) return "You haven't logged a check-in today, so I don't have a readiness score yet.";
    const word = band === "green" ? "ready" : band === "amber" ? "caution" : "recover";
    const recoveryStatus = card?.recovery.status ?? "unknown";
    return `Your readiness is ${Math.round(readiness)}, which is ${word}. Recovery status is ${recoveryStatus}.`;
  }

  return (
    <AppShell
      role="athlete"
      title="My day"
      userName={user?.name}
      nav={nav}
      activeKey={section}
      onNavigate={(k) => {
        if (k === "messages") router.push("/athlete/messages");
        else setSection(k as Section);
      }}
      onSignOut={logout}
      hideProfileMenu
      titleSlot={
        <div className="flex items-center gap-3">
          <ProfileMenu userName={user?.name} role="athlete" onSignOut={logout} avatarClassName="h-[50px] w-[50px] text-base" />
          <div className="min-w-0">
            <p className="label text-accent-strong">Athlete</p>
            <p className="truncate text-sm text-ink-muted">Good morning,</p>
            <p className="truncate font-display text-lg font-bold leading-tight text-ink">{greetingInitials} 👋</p>
          </div>
        </div>
      }
      headerIcon={<CompactDatePicker value={date} onChange={setDate} label="Date" />}
    >
      <div className="space-y-3">
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {info ? <Banner tone="ok">{info}</Banner> : null}
        <DateHistoryStrip value={date} onChange={setDate} />

        {section === "today" ? (
          <div className="space-y-3 animate-rise">
            {card?.injury.active ? (
              <div className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                <Icon.shield />
                <span>
                  {card.injury.bodyPart}
                  {card.injury.restriction ? ` — ${card.injury.restriction}` : ""}
                </span>
              </div>
            ) : null}

            {/* Hero — readiness ring + guidance */}
            <div className="hero-card p-5">
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-[150px] w-[150px] animate-pulse rounded-full bg-surface-inset" />
                  <div className="h-3 w-40 animate-pulse rounded bg-surface-inset" />
                </div>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <Ring value={readiness} size={150} stroke={12} label="readiness" band={band} />
                  <div className="mt-3 flex items-center gap-2">
                    <Chip band={band}>{guidance.word}</Chip>
                  </div>
                  <p className="mt-2 max-w-xs text-xs text-ink-muted">{guidance.line}</p>
                  {readiness === null ? (
                    <button
                      onClick={() => setQuickOpen(true)}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-[#ff7e1a] px-3.5 text-xs font-extrabold text-accent-ink"
                    >
                      <Icon.plus /> Quick check-in
                    </button>
                  ) : (
                    <button
                      onClick={() => setQuickOpen(true)}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3.5 text-xs font-extrabold text-accent-strong"
                    >
                      Update check-in
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Colour key — what green/amber/red mean */}
            <BandLegend />

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="Sleep"
                value={dash(card?.sleep.hours)}
                sub={`qual ${card?.sleep.quality == null ? "—" : wellnessFiveToTen(card.sleep.quality)}/10`}
                icon={<Icon.moon />}
                tint="#fbf7ff"
              />
              <StatTile label="Recovery" value={dash(card?.recovery.score)} sub={card?.recovery.status ?? "—"} icon={<Icon.pulse />} tint="#f5fbf8" />
              <StatTile label="Load" value={dash(latestRpe?.calculatedTrainingLoad)} sub={latestRpe ? `RPE ${latestRpe.rpe}` : "—"} icon={<Icon.flame />} tint="#fff7f1" />
            </div>

            {/* Training summary */}
            <Card title="Training summary">
              <div className="space-y-2">
                {SESSION_SLOTS.map((slot) => (
                  <TrainingSummaryRow
                    key={slot}
                    slot={slot}
                    session={card?.sessions[slot] ?? null}
                    rpe={card?.rpeEntries?.[slot] ?? null}
                    isRestDay={Boolean(card?.isRestDay)}
                    onOpen={() => {
                      setLogFocusSlot(slot);
                      setSection("log");
                    }}
                  />
                ))}
              </div>
            </Card>

            {/* Training load summary */}
            <Card title="Training load" action={<Icon.flame />}>
              {latestRpe ? (
                <div>
                  <div className="flex items-center gap-2">
                    <Chip band={latestRpe.riskFlag}>{latestRpe.riskFlag}</Chip>
                    <span className="nums font-display text-2xl font-extrabold text-ink">
                      {latestRpe.calculatedTrainingLoad}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      load · RPE {latestRpe.rpe} · {SLOT_LABEL[latestRpe.sessionType]}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {latestRpe.trainingCategory} · {latestRpe.plannedIntensityPercent}% intensity
                  </p>
                  {latestRpe.riskReasons && latestRpe.riskReasons.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
                      {latestRpe.riskReasons.map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-ink-faint">No RPE logged today.</p>
              )}
              <button onClick={() => setSection("log")} className="btn-primary mt-3 w-full">
                {latestRpe ? "Edit in Log" : "Log session"}
              </button>
            </Card>
          </div>
        ) : null}

        {section === "progress" ? (
          <div className="space-y-3 animate-rise">
            <div className="flex gap-1.5">
              {(
                [
                  { key: "goals", label: "Goals" },
                  { key: "water", label: "Water" },
                  { key: "trends", label: "Trends" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setProgressTab(t.key)}
                  className={`h-8 flex-1 rounded-full text-xs font-semibold transition ${
                    progressTab === t.key
                      ? "bg-accent text-accent-ink shadow-sm"
                      : "border border-line bg-surface-raised text-ink-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {progressTab === "goals" ? (
              <AchievementsPanel
                data={achievements}
                loading={loading}
                onCheckIn={() => setSection("log")}
                onOpenHydration={() => setProgressTab("water")}
                onOpenLog={() => setSection("log")}
              />
            ) : null}

            {progressTab === "water" ? <HydrationModule date={date} /> : null}

            {progressTab === "trends" ? (
              <ChartTabs
                tabs={[
                  { key: "readiness", label: "Readiness", node: <PerformanceTrendPanel base="/api/athlete" /> },
                  { key: "hr", label: "Heart rate", node: <HeartRatePanel base="/api/athlete" /> },
                  { key: "wellness", label: "Wellness", node: <WellnessTrendPanel base="/api/athlete" /> },
                  { key: "performance", label: "Performance", node: <PerformancePanel base="/api/athlete" /> },
                ]}
              />
            ) : null}
          </div>
        ) : null}

        {section === "log" ? (
          <div className="space-y-3 animate-rise">
            {card ? (
              <SessionLogHub
                card={card}
                date={date}
                runAction={runAction}
                refresh={refresh}
                setInfo={setInfo}
                focusedSlot={logFocusSlot}
              />
            ) : null}

            <div className="hidden">
            {/* Daily check-in — sliders */}
            <Card title="Daily check-in">
              <label className="block">
                <span className="label">Sleep hours</span>
                <input
                  value={wellness.sleepHours}
                  onChange={(e) => setWellness((s) => ({ ...s, sleepHours: e.target.value }))}
                  type="number"
                  min={0}
                  max={14}
                  step={0.5}
                  placeholder="e.g. 8"
                  className="field mt-1.5 nums"
                />
              </label>
              <div className="mt-3 space-y-3">
                {WELLNESS_SLIDERS.map((s) => (
                  <Slider
                    key={s.key}
                    label={s.label}
                    lo={s.lo}
                    hi={s.hi}
                    invert={s.invert}
                    value={Number(wellness[s.key]) || 3}
                    onChange={(v) => setWellness((w) => ({ ...w, [s.key]: String(v) }))}
                  />
                ))}
              </div>
              <button onClick={submitWellness} className="btn-primary mt-4 w-full">
                Save check-in
              </button>
            </Card>

            {/* Attendance */}
            <Card title="Attendance">
              <div className="grid grid-cols-3 gap-2">
                {ATTENDANCE_OPTIONS.map((o) => (
                  <Choice
                    key={o.value}
                    selected={card?.attendance.status === o.value}
                    onClick={() => submitAttendance(o.value)}
                  >
                    {o.label}
                  </Choice>
                ))}
              </div>
            </Card>

            {/* Training */}
            <Card title="Training completion">
              <div className="space-y-3">
                {SESSION_SLOTS.map((slot) => (
                  <div key={slot}>
                    <p className="label mb-1.5">
                      {SLOT_LABEL[slot]}
                      {card?.sessions[slot].type ? ` · ${card.sessions[slot].type}` : ""}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {TRAINING_OPTIONS.map((o) => (
                        <Choice
                          key={o.value}
                          selected={card?.sessions[slot].status === o.value}
                          onClick={() => submitTraining(slot, o.value)}
                        >
                          {o.label}
                        </Choice>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Heart rate — twice daily */}
            <Card title="Heart rate">
              <p className="mb-2 text-[11px] text-ink-faint">Resting bpm — log on waking and before bed.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Waking HR</span>
                  <input
                    value={hrForm.wakeHr}
                    onChange={(e) => setHrForm((s) => ({ ...s, wakeHr: e.target.value }))}
                    type="number"
                    inputMode="numeric"
                    min={25}
                    max={220}
                    placeholder="bpm"
                    className="field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="label">Before bed</span>
                  <input
                    value={hrForm.bedHr}
                    onChange={(e) => setHrForm((s) => ({ ...s, bedHr: e.target.value }))}
                    type="number"
                    inputMode="numeric"
                    min={25}
                    max={220}
                    placeholder="bpm"
                    className="field mt-1"
                  />
                </label>
              </div>
              <button onClick={submitHeartRate} className="btn-primary mt-3 w-full">
                Save heart rate
              </button>
            </Card>

            {/* Recovery */}
            <Card title="Recovery">
              <div className="flex flex-wrap gap-2">
                {RECOVERY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => toggleModality(o.value)}
                    className={`h-9 rounded-full border px-3 text-xs font-semibold transition ${
                      recoveryModalities.includes(o.value)
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line bg-surface-inset text-ink-muted hover:text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <button onClick={submitRecovery} className="btn-primary mt-3 w-full">
                Save recovery
              </button>
            </Card>

          </div>
          </div>
        ) : null}

        {section === "coach" ? (
          <div className="space-y-3 animate-rise">
            <Card title="Coach updates">
              {announcements.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  {coachCount === 0
                    ? "No coach linked yet. Your personal logs still work here."
                    : "No coach announcements yet."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {announcements.map((a) => (
                    <li key={a.id} className="rounded-xl border-l-2 border-accent bg-accent/[0.06] px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm text-ink">{a.body}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-faint">
                        {a.coachName} · {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Coach feedback">
              {coachComments.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  {coachCount === 0
                    ? "Coach feedback appears here after a coach links your profile."
                    : "No coach feedback today."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {coachComments.map((c) => (
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
      </div>

      <QuickCheckIn
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        date={date}
        defaults={{
          sleepHours: card?.sleep.hours ?? null,
          sleepQuality: card?.sleep.quality ?? null,
        }}
        onSaved={() => {
          setInfo("Check-in saved.");
          refresh();
        }}
        hrForm={hrForm}
        setHrForm={setHrForm}
        submitHeartRate={submitHeartRate}
      />

      {speechSupport.supported ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center">
          <div className="flex w-full max-w-md justify-end px-4">
            <button
              onClick={() => setVoiceOpen(true)}
              aria-label="Open voice assistant"
              className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent bg-accent text-accent-ink shadow-hero"
            >
              <Icon.mic />
            </button>
          </div>
        </div>
      ) : null}

      <VoiceAssistantSheet
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        config={{
          date,
          onNavigate: handleVoiceNavigate,
          getStatusSummary: getVoiceStatusSummary,
          refresh,
          coachId: voiceCoachId,
        }}
      />
    </AppShell>
  );
}

function achievementIcon(key: AchievementGoal["key"]) {
  if (key === "check_in") return <Icon.spark />;
  if (key === "training") return <Icon.dumbbell />;
  if (key === "hydration") return <Icon.water />;
  return <Icon.trophy />;
}

function dayLabel(count: number): string {
  return `${count} day${count === 1 ? "" : "s"}`;
}

function achievementActionLabel(key: AchievementGoal["key"]): string {
  if (key === "check_in") return "Check in";
  if (key === "hydration") return "Water";
  return "Open log";
}

function AchievementsPanel({
  data,
  loading,
  onCheckIn,
  onOpenHydration,
  onOpenLog,
}: {
  data: AchievementsResponse | null;
  loading: boolean;
  onCheckIn: () => void;
  onOpenHydration: () => void;
  onOpenLog: () => void;
}) {
  const [rewardGoal, setRewardGoal] = useState<AchievementGoal | null>(null);

  if (loading && !data) {
    return (
      <div className="space-y-3 animate-rise">
        <div className="hero-card p-5">
          <div className="h-4 w-36 animate-pulse rounded bg-surface-inset" />
          <div className="mt-3 h-8 w-56 animate-pulse rounded bg-surface-inset" />
          <div className="mt-5 h-2 w-full animate-pulse rounded-full bg-surface-inset" />
        </div>
        <div className="h-32 animate-pulse rounded-2xl bg-surface-inset" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface-inset" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="surface-card p-5 text-center animate-rise">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-inset text-ink-faint">
          <Icon.trophy />
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">Achievements unavailable</p>
        <p className="mt-1 text-xs text-ink-muted">Try again after your next check-in or training log.</p>
      </div>
    );
  }

  const totalGoals = data.goals.length;
  const unlockedPct = totalGoals ? Math.round((data.summary.unlocked / totalGoals) * 100) : 0;
  const best = data.summary.bestStreak;
  const next = data.summary.nextGoal;

  return (
    <div className="space-y-3 animate-rise">
      <div className="hero-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">
            <Icon.trophy />
          </span>
          <div className="min-w-0 flex-1">
            <p className="label text-accent-strong">Achievements</p>
            <h2 className="font-display text-2xl font-extrabold leading-tight text-ink">
              Goal streaks
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              {data.summary.unlocked} of {totalGoals} goals unlocked
              {next ? ` - ${next.remaining} ${next.remaining === 1 ? "day" : "days"} to ${next.title}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-inset">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${unlockedPct}%` }} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div>
            <p className="label">Best streak</p>
            <p className="nums mt-1 font-display text-xl font-bold text-ink">
              {best ? dayLabel(best.days) : "0 days"}
            </p>
            <p className="truncate text-[11px] text-ink-muted">{best?.title ?? "No streak yet"}</p>
          </div>
          <div>
            <p className="label">Window</p>
            <p className="nums mt-1 font-display text-xl font-bold text-ink">{data.days} days</p>
            <p className="text-[11px] text-ink-muted">Recent goal history</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {data.goals.map((goal) => (
          <AchievementGoalCard
            key={goal.key}
            goal={goal}
            onOpenReward={() => setRewardGoal(goal)}
            onAction={
              goal.key === "check_in"
                ? onCheckIn
                : goal.key === "hydration"
                  ? onOpenHydration
                  : onOpenLog
            }
          />
        ))}
      </div>

      {rewardGoal ? <RewardModal goal={rewardGoal} onClose={() => setRewardGoal(null)} /> : null}
    </div>
  );
}

function AchievementGoalCard({
  goal,
  onOpenReward,
  onAction,
}: {
  goal: AchievementGoal;
  onOpenReward: () => void;
  onAction: () => void;
}) {
  const remaining = Math.max(0, goal.target - goal.currentStreak);
  const recent = goal.history.slice(-14);
  const progressWidth = `${Math.max(4, goal.progress)}%`;

  return (
    <article className="surface-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-inset text-accent-strong">
          {achievementIcon(goal.key)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-bold leading-tight text-ink">{goal.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{goal.description}</p>
            </div>
            <Chip band={goal.tone}>{goal.achieved ? "Unlocked" : `${remaining} left`}</Chip>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <p className="label">{goal.metricLabel}</p>
              <p className="nums mt-1 font-display text-2xl font-extrabold leading-none text-ink">
                {goal.currentStreak}
              </p>
            </div>
            <div>
              <p className="label">Count</p>
              <p className="nums mt-1 font-display text-2xl font-extrabold leading-none text-ink">
                {goal.completedDays}
              </p>
            </div>
            <div className="text-right">
              <p className="label">Longest</p>
              <p className="nums mt-1 font-display text-sm font-bold text-ink">
                {dayLabel(goal.longestStreak)}
              </p>
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-inset">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: progressWidth }} />
          </div>

          <div className="mt-3 flex items-center gap-1" aria-label={`${goal.title} recent history`}>
            {recent.map((day) => (
              <span
                key={day.date}
                title={`${day.date}: ${day.met ? "met" : "missed"}`}
                className={`h-2.5 flex-1 rounded-full ${day.met ? "bg-accent" : "bg-surface-inset"}`}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={onAction} className="btn-secondary h-9 text-xs">
              {achievementActionLabel(goal.key)}
            </button>
            <button
              onClick={onOpenReward}
              disabled={!goal.reward.unlocked}
              className={`h-9 rounded-xl px-3 text-xs font-semibold transition ${
                goal.reward.unlocked
                  ? "bg-accent text-accent-ink shadow-sm hover:brightness-95"
                  : "cursor-not-allowed border border-line bg-surface-inset text-ink-faint"
              }`}
            >
              {goal.reward.unlocked ? "Open reward" : "Reward locked"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function RewardModal({ goal, onClose }: { goal: AchievementGoal; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 px-4 pb-6 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">
            <Icon.trophy />
          </span>
          <button
            onClick={onClose}
            aria-label="Close reward"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-inset text-ink-muted transition hover:text-ink"
          >
            <Icon.x />
          </button>
        </div>
        <p className="label mt-5 text-accent-strong">Reward unlocked</p>
        <h3 className="mt-1 font-display text-2xl font-extrabold leading-tight text-ink">
          {goal.reward.title}
        </h3>
        <p className="mt-2 text-sm text-ink-muted">{goal.reward.description}</p>
        <div className="mt-5 rounded-2xl border border-accent/25 bg-accent-soft p-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-strong">
            {goal.reward.badgeLabel}
          </p>
          <p className="nums mt-2 font-display text-4xl font-extrabold text-ink">
            {goal.currentStreak}
          </p>
          <p className="text-xs text-ink-muted">{goal.title}</p>
        </div>
        <button onClick={onClose} className="btn-primary mt-5 h-10 w-full">
          Done
        </button>
      </div>
    </div>
  );
}

type SessionPhoto = { id: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: string };

type SessionForm = {
  status: SessionStatusValue | "";
  workoutType: string;
  actualDurationMin: string;
  effortRating: number;
  notes: string;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  sleepQuality: number;
  soreness: number;
  fatigue: number;
  moodMotivation: number;
  restingHeartRate: string;
};

type SessionLogHubProps = {
  card: DailyCardData;
  date: string;
  runAction: (fn: () => Promise<Response>) => Promise<boolean>;
  refresh: () => Promise<void>;
  setInfo: React.Dispatch<React.SetStateAction<string | null>>;
  focusedSlot: SessionSlot | null;
};

function SessionLogHub({
  card,
  date,
  runAction,
  refresh,
  setInfo,
  focusedSlot,
}: SessionLogHubProps) {
  const [forms, setForms] = useState<Record<SessionSlot, SessionForm>>(() => makeSessionForms(card));
  const [savingSlot, setSavingSlot] = useState<SessionSlot | null>(null);
  const [savingRest, setSavingRest] = useState(false);
  const [photos, setPhotos] = useState<Record<SessionSlot, SessionPhoto[]>>({ AM: [], AFT: [], PM: [] });
  const [pendingPhoto, setPendingPhoto] = useState<Partial<Record<SessionSlot, { file: File; preview: string }>>>({});
  const [uploadingSlot, setUploadingSlot] = useState<SessionSlot | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const firstOpenSlot = SESSION_SLOTS.find((slot) => !sessionComplete(card.sessions[slot])) ?? SESSION_SLOTS[0];
  const [activeSlot, setActiveSlot] = useState<SessionSlot>(focusedSlot ?? firstOpenSlot);

  useEffect(() => {
    setForms(makeSessionForms(card));
  }, [card]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        SESSION_SLOTS.map(async (slot) => {
          const res = await apiFetch(`/api/athlete/training/${slot}?date=${date}`);
          if (!res.ok) return [slot, []] as const;
          const json = (await res.json()) as { session?: { photos?: SessionPhoto[] } | null };
          return [slot, json.session?.photos ?? []] as const;
        })
      );
      if (cancelled) return;
      setPhotos(Object.fromEntries(entries) as Record<SessionSlot, SessionPhoto[]>);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  function pickPhoto(slot: SessionSlot, file: File | null) {
    setPendingPhoto((prev) => {
      const current = prev[slot];
      if (current) URL.revokeObjectURL(current.preview);
      if (!file) {
        const next = { ...prev };
        delete next[slot];
        return next;
      }
      return { ...prev, [slot]: { file, preview: URL.createObjectURL(file) } };
    });
  }

  async function uploadPhoto(slot: SessionSlot) {
    const pending = pendingPhoto[slot];
    if (!pending) return;
    setUploadingSlot(slot);
    try {
      const form = new FormData();
      form.append("date", date);
      form.append("file", pending.file);
      const res = await apiFetch(`/api/athlete/training/${slot}/photos`, { method: "POST", body: form });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setInfo(
          j.error === "file_too_large"
            ? "That image is too large."
            : j.error === "unsupported_file_type"
              ? "Please choose a JPG, PNG, or WEBP image."
              : "Photo upload failed."
        );
        return;
      }
      const json = (await res.json()) as { photo: SessionPhoto };
      URL.revokeObjectURL(pending.preview);
      pickPhoto(slot, null);
      setPhotos((prev) => ({ ...prev, [slot]: [...(prev[slot] ?? []), json.photo] }));
      setInfo("Photo added.");
    } finally {
      setUploadingSlot(null);
    }
  }

  useEffect(() => {
    if (!focusedSlot) return;
    setActiveSlot(focusedSlot);
    window.requestAnimationFrame(() => {
      hubRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusedSlot]);

  const restDay = isRestDay(card);
  const completedSessions = SESSION_SLOTS.filter((slot) => sessionComplete(card.sessions[slot])).length;
  const totalSteps = restDay ? 1 : SESSION_SLOTS.length;
  const doneSteps = restDay ? 1 : completedSessions;
  const progress = (doneSteps / totalSteps) * 100;
  const activeSession = card.sessions[activeSlot] ?? { status: null, type: null };
  const activeForm = forms[activeSlot];
  const activeRpe = card.rpeEntries?.[activeSlot] ?? null;

  function updateForm<K extends keyof SessionForm>(slot: SessionSlot, key: K, value: SessionForm[K]) {
    setForms((prev) => ({ ...prev, [slot]: { ...prev[slot], [key]: value } }));
  }

  function updateWorkoutType(slot: SessionSlot, workoutType: string) {
    setForms((prev) => {
      const current = prev[slot];
      return {
        ...prev,
        [slot]: {
          ...current,
          workoutType,
          trainingCategory: isTrainingCategory(workoutType) ? workoutType : current.trainingCategory,
        },
      };
    });
  }

  async function toggleRestDay() {
    const enabled = !restDay;
    setSavingRest(true);
    try {
      if (await runAction(() => submitRestDayAction(date, enabled))) {
        setInfo(enabled ? "Rest day saved." : "Rest day cleared.");
        await refresh();
      }
    } finally {
      setSavingRest(false);
    }
  }

  async function saveSession(slot: SessionSlot) {
    const form = forms[slot];
    const status = form.status;
    if (!status) {
      setInfo(`Choose a status for ${SLOT_LABEL[slot]}.`);
      return;
    }

    const duration = parseOptionalNumber(form.actualDurationMin, 0, 600);
    if (duration === false) {
      setInfo("Duration must be between 0 and 600 minutes.");
      return;
    }
    const restingHeartRate = parseOptionalNumber(form.restingHeartRate, 20, 220);
    if (restingHeartRate === false) {
      setInfo("Resting HR must be between 20 and 220 bpm.");
      return;
    }

    setSavingSlot(slot);
    try {
      const trainingOk = await runAction(() =>
        submitTrainingAction(date, slot, {
          status,
          attended: status === "completed",
          workoutType: form.workoutType.trim() || undefined,
          effortRating: form.effortRating,
          notes: form.notes.trim() || undefined,
          actualDurationMin: duration !== null ? duration : undefined,
        })
      );
      if (!trainingOk) return;

      if (status !== "skipped" && status !== "rest") {
        const rpeOk = await runAction(() =>
          submitRpeMonitoringAction(date, {
            sessionType: slot,
            trainingCategory: isTrainingCategory(form.workoutType) ? form.workoutType : form.trainingCategory,
            plannedIntensityPercent: form.plannedIntensityPercent,
            rpe: form.rpe,
            sleepQuality: form.sleepQuality,
            muscleSoreness: form.soreness,
            fatigue: form.fatigue,
            moodMotivation: form.moodMotivation,
            bodyConditionFeedback: form.notes.trim() || undefined,
            restingHeartRate: restingHeartRate !== null ? restingHeartRate : undefined,
          })
        );
        if (!rpeOk) return;
      }

      setInfo(`${SLOT_LABEL[slot]} saved.`);
      await refresh();
    } finally {
      setSavingSlot(null);
    }
  }

  return (
    <>
      <div ref={hubRef}>
      <Card
        title="Today's log"
        action={<span className="nums text-xs font-semibold text-accent-strong">{progress.toFixed(1)}%</span>}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-surface-inset">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs font-semibold text-ink">{doneSteps} of {totalSteps} logged</p>
            <p className="text-[11px] text-ink-muted">{restDay ? "Rest day is active" : "AM, Afternoon, and PM sessions"}</p>
          </div>
          <button
            onClick={toggleRestDay}
            disabled={savingRest}
            className={`h-10 shrink-0 rounded-xl border px-3 text-xs font-semibold transition ${
              restDay
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-inset text-ink-muted hover:text-ink"
            }`}
          >
            {savingRest ? "Saving" : restDay ? "Rest day on" : "Rest day"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {SESSION_SLOTS.map((slot) => {
            const session = card.sessions[slot] ?? { status: null, type: null };
            const rpe = card.rpeEntries?.[slot] ?? null;
            const selected = activeSlot === slot;
            const done = restDay || Boolean(rpe) || sessionComplete(session);
            const title = restDay ? "Rest day" : session.workoutType || session.type || rpe?.trainingCategory || "Training";
            return (
              <button
                key={slot}
                type="button"
                onClick={() => setActiveSlot(slot)}
                className={`min-w-0 rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-accent bg-accent-soft"
                    : done
                      ? "border-ok/30 bg-ok/5"
                      : "border-line bg-surface-inset hover:bg-surface-raised"
                }`}
              >
                <p className={`label ${selected ? "text-accent-strong" : ""}`}>{SLOT_LABEL[slot]}</p>
                <p className="mt-1 truncate text-sm font-semibold text-ink">{title}</p>
                <p className="mt-1 text-[11px] font-semibold text-ink-muted">{done ? "Done" : "Open"}</p>
              </button>
            );
          })}
        </div>

        {restDay ? (
          <div className="mt-3 rounded-xl border border-line bg-surface-raised p-3">
            <p className="text-sm font-semibold text-ink">Rest day is on</p>
            <p className="mt-1 text-xs text-ink-muted">AM, Afternoon, and PM training inputs are paused for this date.</p>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-line bg-surface-raised p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-ink">{SLOT_LABEL[activeSlot]} session</p>
                <p className="text-[11px] text-ink-muted">
                  {activeSession.type ? `Plan: ${activeSession.type}` : "No coach plan"}
                  {activeSession.durationMin ? `, ${activeSession.durationMin} min` : ""}
                </p>
              </div>
              {activeRpe ? <Chip band={activeRpe.riskFlag}>{activeRpe.riskFlag}</Chip> : null}
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {TRAINING_OPTIONS.map((o) => (
                <Choice
                  key={o.value}
                  selected={activeForm.status === o.value}
                  onClick={() => updateForm(activeSlot, "status", o.value)}
                >
                  {o.label}
                </Choice>
              ))}
            </div>

            <label className="mt-3 block">
              <span className="label">Workout type</span>
              <select
                value={activeForm.workoutType}
                onChange={(e) => updateWorkoutType(activeSlot, e.target.value)}
                className="field mt-1.5"
              >
                <option value="">Select workout type</option>
                {workoutTypeChoicesFor(activeForm.workoutType).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Minutes</span>
                <input
                  value={activeForm.actualDurationMin}
                  onChange={(e) => updateForm(activeSlot, "actualDurationMin", e.target.value)}
                  type="number"
                  min={0}
                  max={600}
                  className="field mt-1 nums"
                />
              </label>
              <label className="block">
                <span className="label">Resting HR</span>
                <input
                  value={activeForm.restingHeartRate}
                  onChange={(e) => updateForm(activeSlot, "restingHeartRate", e.target.value)}
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={220}
                  placeholder="bpm"
                  className="field mt-1 nums"
                />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <RangeField
                label="Effort"
                lo="Easy"
                hi="Max"
                value={activeForm.effortRating}
                min={1}
                max={10}
                onChange={(v) => updateForm(activeSlot, "effortRating", v)}
              />
              <RangeField
                label="Planned intensity"
                lo="0%"
                hi="100%"
                value={activeForm.plannedIntensityPercent}
                min={0}
                max={100}
                step={5}
                onChange={(v) => updateForm(activeSlot, "plannedIntensityPercent", v)}
              />
              <RangeField
                label="RPE"
                lo="Rest"
                hi="Max"
                value={activeForm.rpe}
                min={0}
                max={10}
                onChange={(v) => updateForm(activeSlot, "rpe", v)}
              />
              <RangeField
                label="Soreness"
                lo="Fresh"
                hi="Sore"
                value={activeForm.soreness}
                min={0}
                max={5}
                onChange={(v) => updateForm(activeSlot, "soreness", v)}
              />
              <RangeField
                label="Fatigue"
                lo="Rested"
                hi="Spent"
                value={activeForm.fatigue}
                min={0}
                max={5}
                onChange={(v) => updateForm(activeSlot, "fatigue", v)}
              />
              <RangeField
                label="Mood"
                lo="Low"
                hi="High"
                value={activeForm.moodMotivation}
                min={0}
                max={5}
                onChange={(v) => updateForm(activeSlot, "moodMotivation", v)}
              />
            </div>

            <textarea
              value={activeForm.notes}
              onChange={(e) => updateForm(activeSlot, "notes", e.target.value)}
              placeholder="Session notes"
              className="field mt-3 h-20 resize-none py-2"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {photos[activeSlot]?.map((p) => (
                <AuthImage
                  key={p.id}
                  src={`/api/athlete/training/${activeSlot}/photos/${p.id}/file`}
                  alt={p.originalName}
                  className="h-16 w-16 rounded-lg object-cover"
                />
              ))}
              {pendingPhoto[activeSlot] ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img
                    src={pendingPhoto[activeSlot]!.preview}
                    alt="Pending upload"
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                  <button
                    onClick={() => pickPhoto(activeSlot, null)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted"
                    aria-label="Remove photo"
                  >
                    <Icon.x />
                  </button>
                </div>
              ) : (
                <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-ink-faint">
                  <Icon.plus />
                  <span className="text-[9px] font-semibold uppercase">Photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => pickPhoto(activeSlot, e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              {pendingPhoto[activeSlot] ? (
                <button
                  onClick={() => uploadPhoto(activeSlot)}
                  disabled={uploadingSlot === activeSlot}
                  className="btn-secondary h-9 px-3 text-xs"
                >
                  {uploadingSlot === activeSlot ? "Uploading…" : "Save photo"}
                </button>
              ) : null}
            </div>

            {activeRpe ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-inset px-3 py-2">
                <Chip band={activeRpe.riskFlag}>{activeRpe.riskFlag}</Chip>
                <span className="nums text-sm font-semibold text-ink">Load {activeRpe.calculatedTrainingLoad}</span>
                <span className="text-[11px] text-ink-muted">RPE {activeRpe.rpe}</span>
              </div>
            ) : null}

            <button
              onClick={() => saveSession(activeSlot)}
              disabled={savingSlot === activeSlot}
              className="btn-primary mt-3 w-full"
            >
              {savingSlot === activeSlot ? "Saving" : `Save ${SLOT_LABEL[activeSlot]}`}
            </button>
          </div>
        )}

        <div className="hidden">
          {SESSION_SLOTS.map((slot) => {
            const session = card.sessions[slot] ?? { status: null, type: null };
            const form = forms[slot];
            const rpe = card.rpeEntries?.[slot] ?? null;
            const done = sessionComplete(session);
            return (
              <details
                key={slot}
                className={`group rounded-xl border ${
                  done ? "border-ok/30 bg-ok/5" : "border-line bg-surface-inset"
                }`}
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="label">{SLOT_LABEL[slot]}</p>
                    <p className="mt-1 text-base font-semibold text-ink">
                      {form.workoutType || session.type || "Training"}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {session.type ? `Plan: ${session.type}` : "No coach plan"}
                      {session.durationMin ? `, ${session.durationMin} min` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClass(session)}`}>
                      {sessionStatusText(session)}
                    </span>
                    <span className="text-ink-faint transition-transform group-open:rotate-90">
                      <Icon.chevron />
                    </span>
                  </span>
                </summary>

                <div className="border-t border-line p-3">
                <div className="grid grid-cols-3 gap-2">
                  {TRAINING_OPTIONS.map((o) => (
                    <Choice
                      key={o.value}
                      selected={form.status === o.value}
                      onClick={() => updateForm(slot, "status", o.value)}
                    >
                      {o.label}
                    </Choice>
                  ))}
                </div>

                <div className="mt-3">
                  <label className="block">
                    <span className="label">Workout type</span>
                    <select
                      value={form.workoutType}
                      onChange={(e) => updateWorkoutType(slot, e.target.value)}
                      className="field mt-1.5"
                    >
                      <option value="">Select workout type</option>
                      {workoutTypeChoicesFor(form.workoutType).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2">
                  <label className="block">
                    <span className="label">Minutes</span>
                    <input
                      value={form.actualDurationMin}
                      onChange={(e) => updateForm(slot, "actualDurationMin", e.target.value)}
                      type="number"
                      min={0}
                      max={600}
                      className="field mt-1 nums"
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-3">
                  <RangeField
                    label="Effort"
                    lo="Easy"
                    hi="Max"
                    value={form.effortRating}
                    min={1}
                    max={10}
                    onChange={(v) => updateForm(slot, "effortRating", v)}
                  />
                  <RangeField
                    label="Planned intensity"
                    lo="0%"
                    hi="100%"
                    value={form.plannedIntensityPercent}
                    min={0}
                    max={100}
                    onChange={(v) => updateForm(slot, "plannedIntensityPercent", v)}
                  />
                  <RangeField
                    label="RPE"
                    lo="Rest"
                    hi="Max"
                    value={form.rpe}
                    min={0}
                    max={10}
                    onChange={(v) => updateForm(slot, "rpe", v)}
                  />
                </div>

                <div className="mt-3 grid gap-3">
                  <RangeField
                    label="Soreness"
                    lo="Fresh"
                    hi="Sore"
                    value={form.soreness}
                    min={0}
                    max={5}
                    onChange={(v) => updateForm(slot, "soreness", v)}
                  />
                  <RangeField
                    label="Fatigue"
                    lo="Rested"
                    hi="Spent"
                    value={form.fatigue}
                    min={0}
                    max={5}
                    onChange={(v) => updateForm(slot, "fatigue", v)}
                  />
                  <RangeField
                    label="Mood"
                    lo="Low"
                    hi="High"
                    value={form.moodMotivation}
                    min={0}
                    max={5}
                    onChange={(v) => updateForm(slot, "moodMotivation", v)}
                  />
                </div>

                <label className="mt-3 block">
                  <span className="label">Resting HR</span>
                  <input
                    value={form.restingHeartRate}
                    onChange={(e) => updateForm(slot, "restingHeartRate", e.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={20}
                    max={220}
                    placeholder="bpm"
                    className="field mt-1 nums"
                  />
                </label>

                <textarea
                  value={form.notes}
                  onChange={(e) => updateForm(slot, "notes", e.target.value)}
                  placeholder="Session notes"
                  className="field mt-3 h-20 resize-none py-2"
                />

                {rpe ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2">
                    <Chip band={rpe.riskFlag}>{rpe.riskFlag}</Chip>
                    <span className="nums text-sm font-semibold text-ink">Load {rpe.calculatedTrainingLoad}</span>
                    <span className="text-[11px] text-ink-muted">RPE {rpe.rpe}</span>
                  </div>
                ) : null}

                <button
                  onClick={() => saveSession(slot)}
                  disabled={savingSlot === slot}
                  className="btn-primary mt-3 w-full"
                >
                  {savingSlot === slot ? "Saving" : `Save ${SLOT_LABEL[slot]}`}
                </button>
                </div>
              </details>
            );
          })}
        </div>
      </Card>
      </div>
    </>
  );
}

function makeSessionForms(card: DailyCardData): Record<SessionSlot, SessionForm> {
  return SESSION_SLOTS.reduce((acc, slot) => {
    const session = card.sessions[slot] ?? { status: null, type: null };
    const rpe = card.rpeEntries?.[slot] ?? null;
    const plannedIntensity = rpe?.plannedIntensityPercent ?? (session.intensityRpe ? session.intensityRpe * 10 : 70);
    acc[slot] = {
      status: session.attended ? "completed" : cleanStatus(session.status),
      workoutType: session.workoutType ?? session.type ?? "",
      actualDurationMin:
        session.actualDurationMin === null || session.actualDurationMin === undefined
          ? ""
          : String(session.actualDurationMin),
      effortRating: session.effortRating ?? session.intensityRpe ?? 5,
      notes: session.notes ?? "",
      trainingCategory: rpe?.trainingCategory ?? CATEGORY_CHOICES[0],
      plannedIntensityPercent: Math.max(0, Math.min(100, plannedIntensity)),
      rpe: rpe?.rpe ?? session.effortRating ?? session.intensityRpe ?? 5,
      sleepQuality: rpe?.sleepQuality ?? card.sleep.quality ?? 3,
      soreness: rpe?.muscleSoreness ?? card.soreness ?? 3,
      fatigue: rpe?.fatigue ?? 3,
      moodMotivation: rpe?.moodMotivation ?? 3,
      restingHeartRate:
        rpe?.restingHeartRate === null || rpe?.restingHeartRate === undefined
          ? card.recovery.restingHr?.toString() ?? card.heartRate.wakeHr?.toString() ?? ""
          : String(rpe.restingHeartRate),
    };
    return acc;
  }, {} as Record<SessionSlot, SessionForm>);
}

function cleanStatus(value: string | null | undefined): SessionStatusValue | "" {
  const option = TRAINING_OPTIONS.find((o) => o.value === value);
  return option?.value ?? "";
}

function isRestDay(card: DailyCardData) {
  return Boolean(card.isRestDay || card.attendance.status === "rest");
}

function sessionComplete(session: DailySession | undefined) {
  if (!session) return false;
  return (
    session.attended === true ||
    session.status === "completed" ||
    session.status === "skipped" ||
    session.status === "rest"
  );
}

function sessionStatusText(session: DailySession | undefined) {
  if (!session) return "Open";
  if (session.attended === true || session.status === "completed") return "Done";
  if (session.status === "skipped") return "Missed";
  if (session.status === "in_progress") return "Partial";
  if (session.status === "rest") return "Rest";
  return "Open";
}

function statusClass(session: DailySession | undefined) {
  if (session?.attended === true || session?.status === "completed") return "bg-ok/10 text-ok";
  if (session?.status === "skipped") return "bg-bad/10 text-bad";
  if (session?.status === "in_progress") return "bg-warn/10 text-warn";
  return "bg-surface-raised text-ink-muted";
}

function workoutTypeChoicesFor(current: string) {
  return current && !WORKOUT_TYPES.some((type) => type === current) ? [current, ...WORKOUT_TYPES] : [...WORKOUT_TYPES];
}

function isTrainingCategory(value: string) {
  return (CATEGORY_CHOICES as readonly string[]).includes(value);
}

function parseOptionalNumber(raw: string, min: number, max: number): number | null | false {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return false;
  return n;
}

function RangeField({
  label,
  lo,
  hi,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  lo: string;
  hi: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs">
        <span className="font-medium text-ink-muted">{label}</span>
        <span className="nums font-display font-semibold text-accent-strong">{value}</span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        type="range"
        min={min}
        max={max}
        step={step}
        aria-label={label}
        style={{ accentColor: "var(--accent)" }}
        className="mt-1 w-full"
      />
      <div className="mt-0.5 flex justify-between text-[10px] uppercase tracking-wide text-ink-faint">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </label>
  );
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

function dayShort(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short" });
}

function dayNumber(iso: string) {
  return String(Number(iso.slice(-2)));
}

function DateHistoryStrip({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const today = localIsoDate(new Date());
  const windowEnd = addDaysIso(value, 15) > today ? today : addDaysIso(value, 15);
  const windowStart = addDaysIso(windowEnd, -30);
  const days = Array.from({ length: 31 }, (_, index) => addDaysIso(windowStart, index));
  const selectedIsToday = value === today;

  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [value]);

  return (
    <div className="surface-card p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => onChange(today)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            selectedIsToday
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-line bg-surface-inset text-ink-muted hover:text-ink"
          }`}
        >
          Today
        </button>
        <p className="nums text-xs font-semibold text-accent-strong">{value}</p>
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((day) => {
          const selected = day === value;
          return (
            <button
              key={day}
              ref={selected ? selectedRef : null}
              onClick={() => onChange(day)}
              aria-pressed={selected}
              className={`flex w-12 shrink-0 flex-col items-center rounded-xl border px-1 py-2 transition ${
                selected
                  ? "border-accent/35 bg-accent-soft text-accent-strong shadow-sm"
                  : "border-transparent text-ink-muted hover:border-line hover:bg-surface-inset"
              }`}
            >
              <span className="text-[10px] font-semibold">{dayShort(day)}</span>
              <span className="nums mt-1 font-display text-base font-bold">{dayNumber(day)}</span>
              <span className={`mt-1 h-1.5 w-1.5 rounded-full ${selected ? "bg-accent" : "bg-ink-faint/45"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "bad"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-bad/30 bg-bad/10 text-bad";
  return <div className={`rounded-xl border px-3 py-2.5 text-sm ${cls}`}>{children}</div>;
}

/** Plain-language key for the green/amber/red colours used across the app
 *  (readiness ring, recovery, risk flags). The three dots stay visible so the
 *  colours are explained at a glance; tap to expand the full meanings. */
function BandLegend() {
  const [open, setOpen] = useState(false);
  const rows = [
    { dot: "bg-ok", label: "Good", range: "80–100", note: "Ready to train and well recovered." },
    { dot: "bg-warn", label: "Caution", range: "60–79", note: "Manage your load and listen to your body." },
    { dot: "bg-bad", label: "Attention", range: "Below 60", note: "Prioritise recovery and tell your coach." },
  ];
  return (
    <div className="surface-card p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2"
      >
        <span className="label">What the colours mean</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ok" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn" />
          <span className="h-2.5 w-2.5 rounded-full bg-bad" />
          <span className={`text-ink-faint transition-transform ${open ? "-rotate-90" : "rotate-90"}`}>
            <Icon.chevron />
          </span>
        </span>
      </button>
      {open ? (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start gap-3">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${r.dot}`} />
              <span className="min-w-0">
                <span className="text-sm font-semibold text-ink">{r.label}</span>
                <span className="text-[11px] text-ink-faint"> · {r.range}</span>
                <span className="block text-[11px] text-ink-muted">{r.note}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TrainingSummaryRow({
  slot,
  session,
  rpe,
  isRestDay,
  onOpen,
}: {
  slot: SessionSlot;
  session: DailySession | null;
  rpe: RpeEntry | null;
  isRestDay: boolean;
  onOpen: () => void;
}) {
  const logged = sessionComplete(session ?? undefined) || Boolean(rpe);
  const title = isRestDay
    ? "Rest day"
    : session?.workoutType ?? session?.type ?? rpe?.trainingCategory ?? (logged ? "Workout logged" : "Open");
  const status = isRestDay ? "Recovery available" : logged ? sessionStatusText(session ?? undefined).replace("Open", "Done") : "Open";
  const subtitle = rpe && !isRestDay ? `Done · RPE ${rpe.rpe}` : status;
  const isPm = slot === "PM";
  const label = slot === "AFT" ? "AFTERNOON" : SLOT_LABEL[slot].toUpperCase();

  return (
    <button
      onClick={onOpen}
      title={`${SLOT_LABEL[slot]}: ${title}`}
      className={`flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left transition hover:border-accent/35 ${
        logged ? "border-ok/20 bg-ok/[0.03]" : "border-line bg-surface-raised"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl ${
          isPm ? "bg-[#f0f2fb] text-[#5670ad]" : "bg-[#fff3df] text-[#e97912]"
        }`}
      >
        {isPm ? <Icon.moon /> : <Icon.sun />}
        <span className={`mt-0.5 text-[11px] font-black ${isPm ? "text-[#5670ad]" : "text-[#b85307]"}`}>{slot}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black text-ink">{title}</span>
        <span className="block truncate text-[10px] font-medium text-ink-muted">{subtitle}</span>
        <span className="block truncate text-[10px] font-medium text-ink-muted">{label}</span>
      </span>
      <span className="shrink-0 text-[11px] font-bold text-accent-strong">{logged ? "Edit log" : "Open log"}</span>
      <span className="shrink-0 text-ink-muted"><Icon.chevron /></span>
    </button>
  );
}

function Slider({
  label,
  lo,
  hi,
  value,
  onChange,
  invert,
}: {
  label: string;
  lo: string;
  hi: string;
  value: number;
  onChange: (v: number) => void;
  /** When true, higher values are worse (stress/soreness/fatigue) — tint amber/red as they rise. */
  invert?: boolean;
}) {
  // Risk-direction band: for inverted metrics a high value is bad; otherwise a low value is bad.
  const severity = invert ? value : 11 - value; // 10 = worst, 1 = best
  const tone =
    severity >= 9 ? "var(--bad)" : severity >= 7 ? "var(--warn)" : "var(--accent)";
  const valueColor =
    severity >= 9 ? "text-bad" : severity >= 7 ? "text-warn" : "text-accent-strong";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="font-medium text-ink-muted">{label}</span>
        <span className={`nums font-display font-semibold ${valueColor}`}>{value}/10</span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        type="range"
        min={1}
        max={10}
        step={1}
        aria-label={label}
        style={{ accentColor: tone }}
        className="mt-1 w-full"
      />
      <div className="mt-0.5 flex justify-between text-[10px] uppercase tracking-wide text-ink-faint">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 rounded-xl border text-sm font-semibold transition ${
        selected
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-surface-inset text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
