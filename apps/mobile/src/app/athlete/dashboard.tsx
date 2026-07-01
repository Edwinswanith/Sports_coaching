import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { AppFrame, type NativeNavItem } from "../../components/AppFrame";
import { Card, Muted, PrimaryButton, TextField } from "../../components/ui";
import { DatePickerPill } from "../../components/DatePickerPill";
import { type MessageParty, type MessageView } from "../../components/MessageCenter";
import { Ring } from "../../components/Ring";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../lib/sessions";
import { TRAINING_CATEGORIES } from "../../lib/trainingCategories";
import {
  summarizeTrend,
  fmtValue,
  fmtMagnitude,
  column,
  latestVal,
  type TrendSummary,
} from "../../lib/trendStats";

type Section = "today" | "trends" | "log" | "water" | "coach" | "messages";
type Band = "green" | "amber" | "red";

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

type RpeEntry = {
  _id?: string;
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  calculatedTrainingLoad: number;
  riskFlag: Band;
  riskReasons?: string[];
  readinessScore?: number;
  readinessBand?: Band;
  sleepQuality?: number;
  muscleSoreness?: number;
  fatigue?: number;
  moodMotivation?: number;
  bodyConditionFeedback?: string | null;
};

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  date: string;
  isRestDay?: boolean;
  attendance: { status: string | null; note?: string | null };
  sessions: Record<SessionSlot, DailySession>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  heartRate: { wakeHr: number | null; bedHr: number | null };
  recovery: { status: string | null; score: number | null; restingHr?: number | null; hrv?: number | null };
  injury: { active: boolean; bodyPart: string | null; severity: string | null; restriction: string | null };
  rpe?: RpeEntry | null;
  rpeEntries?: Record<SessionSlot, RpeEntry | null>;
};
type DailyResponse = { date: string; card: DailyCard };
type FeedItem = { id: string; at: string; kind: string; title: string; subtitle?: string; detail?: string; band?: Band };
type AthleteNote = { _id: string; body: string; date: string; createdAt: string };
type CoachComment = { _id: string; body: string; date: string; createdAt: string; coachId: string };
type TeamAnnouncement = { id: string; body: string; coachName: string; createdAt: string };
type AssignedCoach = { coachId: string; name: string };
type MessageThreadSummary = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "coach" | "athlete";
  unreadCount: number;
};
type WaterDay = { date: string; goalMl: number; totalMl: number; entries: { id: string; amountMl: number; loggedAt: string }[] };
type TrendPoint = { date: string; readiness: number | null; load: number | null; sleepHours: number | null; recoveryScore: number | null };
type WellnessPoint = {
  date: string;
  sleepQuality: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  fatigue: number | null;
  wakeHr?: number | null;
  bedHr?: number | null;
  waterPct?: number | null;
};
type PerfPoint = { date: string; value: number; metric: string; unit: string };

type WellnessForm = {
  sleepHours: string;
  sleepQuality: string;
  mood: string;
  stress: string;
  soreness: string;
  fatigue: string;
};
type MessageHeader = { title: string; subtitle?: string };

const theme = ROLE_THEMES.athlete;
const today = () => new Date().toISOString().slice(0, 10);
const emptyWellness: WellnessForm = {
  sleepHours: "",
  sleepQuality: "3",
  mood: "3",
  stress: "3",
  soreness: "3",
  fatigue: "3",
};

const NAV: NativeNavItem[] = [
  { key: "today", label: "Today", icon: "home-outline" },
  { key: "trends", label: "Trends", icon: "trending-up-outline" },
  { key: "log", label: "Log", icon: "add-outline" },
  { key: "water", label: "Water", icon: "water-outline" },
  { key: "coach", label: "Coach", icon: "chatbubble-outline" },
  { key: "messages", label: "Chat", icon: "chatbubble-ellipses-outline" },
];

const ATTENDANCE = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
] as const;
const TRAINING_STATUS = [
  { value: "completed", label: "Done" },
  { value: "in_progress", label: "Partial" },
  { value: "skipped", label: "Missed" },
] as const;
type SessionStatusValue = (typeof TRAINING_STATUS)[number]["value"];
const WORKOUT_TYPES = TRAINING_CATEGORIES;
const CATEGORY_CHOICES = TRAINING_CATEGORIES;
const RECOVERY_OPTIONS = ["Stretching", "Ice bath", "Mobility", "Physio", "Hydration"];

function dash(v: string | number | null | undefined) {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

function bandFor(score: number | null): Band {
  if (score == null) return "amber";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}

function bandColor(band: Band) {
  if (band === "green") return colors.ok;
  if (band === "amber") return colors.warn;
  return colors.bad;
}

function readinessGuidance(score: number | null) {
  if (score === null) return { word: "No check-in", line: "Log today's check-in to see your readiness indicator." };
  const band = bandFor(score);
  if (band === "green") return { word: "Ready", line: "Readiness indicator looks strong - cleared for full training." };
  if (band === "amber") return { word: "Caution", line: "Moderate readiness - manage load and listen to your body." };
  return { word: "Recover", line: "Low readiness indicator - prioritise recovery and tell your coach." };
}

function shortDate(date: string) {
  const [, m, d] = date.split("-");
  return `${m}-${d}`;
}

function litres(ml: number) {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function latest<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

function sectionFromParam(value: string | undefined): Section {
  if (value === "today" || value === "trends" || value === "log" || value === "water" || value === "coach" || value === "messages") return value;
  if (value === "chat") return "messages";
  return "today";
}

export default function AthleteDashboard() {
  const params = useLocalSearchParams<{ section?: string; coachId?: string }>();
  const requestedCoachId = typeof params.coachId === "string" ? params.coachId : null;
  const [section, setSection] = useState<Section>(() => sectionFromParam(params.section));
  const [date, setDate] = useState(today());
  const [card, setCard] = useState<DailyCard | null>(null);
  const [notes, setNotes] = useState<AthleteNote[]>([]);
  const [coachComments, setCoachComments] = useState<CoachComment[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [coachCount, setCoachCount] = useState<number | null>(null);
  const [rpeEntries, setRpeEntries] = useState<RpeEntry[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [messageHeader, setMessageHeader] = useState<MessageHeader>({ title: "Messages", subtitle: "Direct message" });
  const [logFocusSlot, setLogFocusSlot] = useState<SessionSlot | null>(null);

  const [wellness, setWellness] = useState<WellnessForm>(emptyWellness);
  const [hrForm, setHrForm] = useState({ wakeHr: "", bedHr: "" });
  const [recoveryModalities, setRecoveryModalities] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [daily, notesRes, commentsRes, rpeRes, activityRes, annRes] = await Promise.all([
        apiJson<DailyResponse>(`/api/athlete/daily?date=${date}`),
        apiJson<{ notes: AthleteNote[] }>(`/api/athlete/notes?date=${date}`).catch(() => ({ notes: [] })),
        apiJson<{ comments: CoachComment[] }>(`/api/athlete/coach-comments?date=${date}`).catch(() => ({ comments: [] })),
        apiJson<{ entries: RpeEntry[] }>(`/api/athlete/rpe-monitoring?date=${date}`).catch(() => ({ entries: [] })),
        apiJson<{ items: FeedItem[] }>("/api/athlete/activity?limit=30").catch(() => ({ items: [] })),
        apiJson<{ announcements?: TeamAnnouncement[]; coachCount?: number }>("/api/athlete/announcements").catch(() => ({
          announcements: [],
          coachCount: 0,
        })),
      ]);

      setCard(daily.card);
      setNotes(notesRes.notes ?? []);
      setCoachComments(commentsRes.comments ?? []);
      setRpeEntries(rpeRes.entries ?? []);
      setActivity(activityRes.items ?? []);
      setAnnouncements(annRes.announcements ?? []);
      setCoachCount(annRes.coachCount ?? null);
      setWellness({
        sleepHours: daily.card.sleep.hours?.toString() ?? "",
        sleepQuality: daily.card.sleep.quality?.toString() ?? "3",
        mood: "3",
        stress: "3",
        soreness: daily.card.soreness?.toString() ?? "3",
        fatigue: "3",
      });
      setHrForm({
        wakeHr: daily.card.heartRate.wakeHr?.toString() ?? "",
        bedHr: daily.card.heartRate.bedHr?.toString() ?? "",
      });
    } catch {
      setError("Unable to load your day.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (
      params.section === "today" ||
      params.section === "trends" ||
      params.section === "log" ||
      params.section === "water" ||
      params.section === "coach" ||
      params.section === "messages" ||
      params.section === "chat"
    ) {
      setSection(sectionFromParam(params.section));
    }
  }, [params.section]);

  async function postJson(path: string, body: unknown, success: string) {
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text().catch(() => ""));
      setInfo(success);
      await load(true);
      return true;
    } catch {
      setError("Save failed. Check your connection and try again.");
      return false;
    }
  }

  async function submitWellness() {
    return postJson(
      "/api/athlete/wellness",
      {
        date,
        sleepHours: wellness.sleepHours ? Number(wellness.sleepHours) : undefined,
        sleepQuality: Number(wellness.sleepQuality),
        mood: Number(wellness.mood),
        stress: Number(wellness.stress),
        soreness: Number(wellness.soreness),
        fatigue: Number(wellness.fatigue),
      },
      "Check-in saved."
    );
  }

  async function submitHeartRate() {
    const payload: Record<string, number | string> = { date };
    for (const key of ["wakeHr", "bedHr"] as const) {
      const raw = hrForm[key].trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 25 || n > 220) {
        setInfo("Heart rate must be between 25 and 220 bpm.");
        return false;
      }
      payload[key] = n;
    }
    if (!("wakeHr" in payload) && !("bedHr" in payload)) {
      setInfo("Enter your waking and/or before-bed heart rate.");
      return false;
    }
    return postJson("/api/athlete/heart-rate", payload, "Heart rate saved.");
  }

  async function submitNote() {
    const body = noteDraft.trim();
    if (!body) return false;
    const ok = await postJson("/api/athlete/notes", { date, body }, "Note saved.");
    if (ok) setNoteDraft("");
    return ok;
  }

  function toggleRecovery(value: string) {
    setRecoveryModalities((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }

  const readiness = card?.readinessScore ?? null;
  const latestRpe = latest(rpeEntries);
  const isMessages = section === "messages";
  const showCheckInNudge = Boolean(
    card && !loading && readiness === null && !nudgeDismissed && date === today() && !isMessages
  );
  const nav = useMemo(
    () => NAV.map((item) => item.key === "coach" ? { ...item, badge: coachComments.length || undefined } : item),
    [coachComments.length]
  );

  return (
    <AppFrame
      role="athlete"
      title={isMessages ? messageHeader.title : "My day"}
      subtitle={isMessages ? messageHeader.subtitle : undefined}
      nav={nav}
      activeKey={section}
      onNavigate={(key) => setSection(key as Section)}
      headerAction={isMessages ? undefined : <DatePickerPill value={date} onChange={setDate} />}
    >
      {isMessages ? (
        <AthleteMessagesPanel initialCoachId={requestedCoachId} onHeaderChange={setMessageHeader} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.accent} />}
        >
          {error ? <Notice tone="bad" text={error} /> : null}
          {info ? <Notice tone="ok" text={info} /> : null}
          {loading && !card ? (
            <ActivityIndicator color={theme.accentStrong} style={{ marginTop: 40 }} />
          ) : null}

          {showCheckInNudge ? (
            <CheckInNudge onCheckIn={() => setSection("log")} onDismiss={() => setNudgeDismissed(true)} />
          ) : null}

          {!loading && section === "today" && card ? (
            <TodaySection
              card={card}
              readiness={readiness}
              latestRpe={latestRpe}
              date={date}
              onRefresh={load}
              onGoLog={() => setSection("log")}
              onOpenSlot={(slot) => {
                setLogFocusSlot(slot);
                setSection("log");
              }}
            />
          ) : null}

          {!loading && section === "trends" ? <TrendsSection /> : null}

          {!loading && section === "log" && card ? (
            <SessionLogSection
              card={card}
              wellness={wellness}
              setWellness={setWellness}
              hrForm={hrForm}
              setHrForm={setHrForm}
              recoveryModalities={recoveryModalities}
              toggleRecovery={toggleRecovery}
              noteDraft={noteDraft}
              setNoteDraft={setNoteDraft}
              notes={notes}
              submitWellness={submitWellness}
              submitHeartRate={submitHeartRate}
              submitNote={submitNote}
              postJson={postJson}
              date={date}
              focusedSlot={logFocusSlot}
            />
          ) : null}

          {!loading && section === "water" ? (
            <View style={styles.stack}>
              <HydrationCard date={date} />
            </View>
          ) : null}

          {!loading && section === "coach" ? (
            <CoachSection
              announcements={announcements}
              coachComments={coachComments}
              coachCount={coachCount}
              activity={activity}
            />
          ) : null}
        </ScrollView>
      )}
    </AppFrame>
  );
}

function CheckInNudge({ onCheckIn, onDismiss }: { onCheckIn: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.checkInNudge}>
      <View style={styles.checkInIcon}>
        <Ionicons name="flash-outline" size={15} color={theme.accentStrong} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.checkInTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
          {"You haven't checked in today"}
        </Text>
        <Text style={styles.checkInSub}>Takes about 30 seconds.</Text>
      </View>
      <Pressable onPress={onCheckIn} style={styles.checkInButton}>
        <Text style={styles.checkInButtonText}>Check in</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={10} style={styles.checkInClose} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={16} color={colors.inkFaint} />
      </Pressable>
    </View>
  );
}

function Notice({ tone, text }: { tone: "ok" | "bad"; text: string }) {
  const color = tone === "ok" ? colors.ok : colors.bad;
  return (
    <View style={[styles.notice, { borderColor: `${color}55`, backgroundColor: `${color}14` }]}>
      <Text style={[styles.noticeText, { color }]}>{text}</Text>
    </View>
  );
}

function TodaySection({
  card,
  readiness,
  latestRpe,
  date,
  onRefresh,
  onGoLog,
  onOpenSlot,
}: {
  card: DailyCard;
  readiness: number | null;
  latestRpe?: RpeEntry;
  date: string;
  onRefresh: () => Promise<void>;
  onGoLog: () => void;
  onOpenSlot: (slot: SessionSlot) => void;
}) {
  const guidance = readinessGuidance(readiness);
  const band = bandFor(readiness);
  const hasCheckIn = readiness !== null;
  const heroButtonStyle = hasCheckIn ? styles.heroButtonSecondary : styles.heroButtonPrimary;
  const heroButtonTextStyle = hasCheckIn ? styles.heroButtonSecondaryText : styles.heroButtonPrimaryText;
  const heroButtonIcon = hasCheckIn ? theme.accentStrong : theme.accentInk;
  return (
    <View style={styles.stack}>
      {card.injury.active ? (
        <View style={styles.warnStrip}>
          <Ionicons name="shield-outline" size={14} color={colors.warn} />
          <Text style={styles.warnText}>
            {card.injury.bodyPart}
            {card.injury.restriction ? ` - ${card.injury.restriction}` : ""}
          </Text>
        </View>
      ) : null}

      <LinearGradient
        colors={["rgba(239,169,78,0.10)", "#ffffff", "rgba(255,126,26,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <Ring score={readiness} size={150} stroke={12} label="readiness" />
        <Chip band={band} style={{ marginTop: 12 }}>{guidance.word}</Chip>
        <Text style={styles.heroText}>{guidance.line}</Text>
        <Pressable onPress={onGoLog} style={[styles.heroButton, heroButtonStyle]}>
          <Ionicons name="add" size={16} color={heroButtonIcon} />
          <Text style={[styles.heroButtonText, heroButtonTextStyle]}>{readiness === null ? "Complete check-in" : "Update check-in"}</Text>
        </Pressable>
      </LinearGradient>

      <BandLegend />

      <View style={styles.statGrid}>
        <StatTile label="Sleep" value={dash(card.sleep.hours)} sub={`qual ${dash(card.sleep.quality)}/5`} icon="moon-outline" />
        <StatTile label="Recovery" value={dash(card.recovery.score)} sub={card.recovery.status ?? "-"} icon="pulse-outline" />
        <StatTile label="Load" value={dash(latestRpe?.calculatedTrainingLoad)} sub={latestRpe ? `RPE ${latestRpe.rpe}` : "-"} icon="flame-outline" />
      </View>

      <Card>
        <CardTitle>{"Today's plan"}</CardTitle>
        <View style={styles.planGrid}>
          {SESSION_SLOTS.map((slot) => (
            <SlotPill
              key={slot}
              slot={slot}
              session={card.sessions[slot]}
              rpe={card.rpeEntries?.[slot] ?? null}
              isRestDay={Boolean(card.isRestDay)}
              onPress={() => onOpenSlot(slot)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <View style={styles.cardTitleRow}>
          <CardTitle>Training load</CardTitle>
          <Ionicons name="flame-outline" size={14} color={colors.inkMuted} />
        </View>
        {latestRpe ? (
          <>
            <View style={styles.loadRow}>
              <Chip band={latestRpe.riskFlag}>{latestRpe.riskFlag}</Chip>
              <Text style={styles.loadValue}>{latestRpe.calculatedTrainingLoad}</Text>
              <Text style={styles.loadMeta}>load · RPE {latestRpe.rpe} · {SLOT_LABEL[latestRpe.sessionType]}</Text>
            </View>
            <Text style={styles.miniMuted}>
              {latestRpe.trainingCategory} · {latestRpe.plannedIntensityPercent}% intensity
            </Text>
            {latestRpe.riskReasons && latestRpe.riskReasons.length > 0 ? (
              <View style={styles.riskReasonList}>
                {latestRpe.riskReasons.map((reason, index) => (
                  <Text key={`${reason}-${index}`} style={styles.riskReasonText}>- {reason}</Text>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Muted>No RPE logged today.</Muted>
        )}
        <View style={{ marginTop: 12 }}>
          <PrimaryButton
            label={latestRpe ? "Edit / add a session" : "Log RPE"}
            onPress={onGoLog}
            accent={theme.accent}
            accentInk={theme.accentInk}
          />
        </View>
      </Card>
    </View>
  );
}

const BAND_LEGEND_ROWS: { band: Band; label: string; range: string; note: string }[] = [
  { band: "green", label: "Good", range: "80-100", note: "Ready to train and well recovered." },
  { band: "amber", label: "Caution", range: "60-79", note: "Manage your load and listen to your body." },
  { band: "red", label: "Attention", range: "Below 60", note: "Prioritise recovery and tell your coach." },
];

function BandLegend() {
  const [open, setOpen] = useState(false);

  return (
    <Card style={styles.bandLegendCard}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.bandLegendHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <CardTitle>What the colours mean</CardTitle>
        <View style={styles.bandLegendHeaderRight}>
          {BAND_LEGEND_ROWS.map((row) => (
            <View key={row.band} style={[styles.bandLegendDot, { backgroundColor: bandColor(row.band) }]} />
          ))}
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.inkFaint} />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.bandLegendRows}>
          {BAND_LEGEND_ROWS.map((row) => (
            <View key={row.band} style={styles.bandLegendRow}>
              <View style={[styles.bandLegendRowDot, { backgroundColor: bandColor(row.band) }]} />
              <View style={styles.bandLegendText}>
                <Text style={styles.bandLegendLine}>
                  <Text style={styles.bandLegendLabel}>{row.label}</Text>
                  <Text style={styles.bandLegendRange}> · {row.range}</Text>
                </Text>
                <Text style={styles.bandLegendNote}>{row.note}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function StatTile({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.tileLabelRow}>
        <Ionicons name={icon} size={13} color={colors.inkFaint} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  );
}

function SlotPill({
  slot,
  session,
  rpe,
  isRestDay,
  onPress,
}: {
  slot: SessionSlot;
  session: DailySession;
  rpe?: RpeEntry | null;
  isRestDay: boolean;
  onPress: () => void;
}) {
  const status = isRestDay ? "rest" : session.status;
  const done = Boolean(rpe || sessionComplete(session));
  const title = isRestDay ? "Rest day" : session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Open";
  const sub = isRestDay ? "Recovery available" : rpe ? `Done - RPE ${rpe.rpe}` : status ? status.replace("_", " ") : "Open";
  return (
    <Pressable onPress={onPress} style={[styles.slotPill, done ? styles.slotPillDone : null]} accessibilityRole="button">
      <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {SLOT_LABEL[slot]}
      </Text>
      <Text style={styles.slotType} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {title}
      </Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </Pressable>
  );
}

function CompactScale({
  label,
  value,
  onChange,
  lowHint,
  highHint,
  min = 1,
  max = 5,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  lowHint: string;
  highHint: string;
  min?: number;
  max?: number;
}) {
  const [width, setWidth] = useState(1);
  const fallback = Math.round((min + max) / 2);
  const current = Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const pct = max === min ? 0 : ((current - min) / (max - min)) * 100;

  return (
    <View>
      <View style={styles.scaleHeader}>
        <Text style={styles.scaleLabel}>{label}</Text>
        <Text style={styles.scaleValue}>{current}</Text>
      </View>
      <Pressable
        onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
        onPress={(e) => {
          const next = Math.max(min, Math.min(max, Math.round((e.nativeEvent.locationX / width) * (max - min)) + min));
          onChange(next);
        }}
        style={styles.scaleTrack}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
      >
        <View style={styles.scaleBase} />
        <View style={[styles.scaleFill, { width: `${pct}%` }]} />
        <View style={[styles.scaleThumb, { left: `${pct}%` }]} />
      </Pressable>
      <View style={styles.scaleHints}>
        <Text style={styles.scaleHint}>{lowHint}</Text>
        <Text style={styles.scaleHint}>{highHint}</Text>
      </View>
    </View>
  );
}

function HydrationCard({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<WaterDay>(`/api/athlete/water?date=${date}`);
      setDay(res);
    } catch {
      // keep last state
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(amountMl: number) {
    await mutate(() =>
      apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ date, amountMl }),
      })
    );
  }

  async function remove(id: string) {
    await mutate(() => apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" }));
  }

  async function mutate(run: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const pct = Math.min(100, Math.round((total / goal) * 100));
  const reached = total >= goal;

  return (
    <Card>
      <CardTitle>Hydration</CardTitle>
      <View style={styles.hydrationHeader}>
        <Text style={styles.hydrationTotal}>{litres(total)}<Text style={styles.hydrationUnit}> / {litres(goal)} L</Text></Text>
        <Text style={[styles.hydrationPct, reached ? { color: colors.ok } : null]}>{pct}%{reached ? " · goal met" : ""}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: reached ? colors.ok : "#ff7e1a" }]} />
      </View>
      <View style={styles.quickWaterGrid}>
        {[250, 500, 750].map((ml) => (
          <Pressable key={ml} disabled={busy} onPress={() => add(ml)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>+{ml} ml</Text>
          </Pressable>
        ))}
      </View>
      {day && day.entries.length > 0 ? (
        <View style={styles.waterEntryWrap}>
          {day.entries.map((entry) => (
            <Pressable
              key={entry.id}
              disabled={busy}
              onPress={() => remove(entry.id)}
              style={({ pressed }) => [styles.waterEntryChip, pressed ? { borderColor: `${colors.bad}55` } : null]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.amountMl} ml`}
            >
              <Text style={styles.waterEntryText}>{entry.amountMl} ml x</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={[styles.miniMuted, { marginTop: 12 }]}>Tap a button each time you drink.</Text>
      )}
    </Card>
  );
}

const TREND_TABS = [
  { key: "readiness", label: "Readiness" },
  { key: "hr", label: "Heart rate" },
  { key: "wellness", label: "Wellness" },
  { key: "performance", label: "Performance" },
] as const;
type TrendTab = (typeof TREND_TABS)[number]["key"];

function TrendsSection() {
  const [tab, setTab] = useState<TrendTab>("readiness");
  return (
    <View style={styles.stack}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendTabs}>
        {TREND_TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.trendTab, on ? styles.trendTabOn : null]}>
              <Text style={[styles.trendTabText, on ? styles.trendTabTextOn : null]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {tab === "readiness" ? <PerformanceTrendPanel /> : null}
      {tab === "hr" ? <HeartRatePanel /> : null}
      {tab === "wellness" ? <WellnessSignalsPanel /> : null}
      {tab === "performance" ? <PerformanceMetricPanel /> : null}
    </View>
  );
}

/** Big current value + its trend verdict, tinted to match its chart line. */
function TrendTile({
  label,
  value,
  unit,
  color,
  badge,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  badge?: React.ReactNode;
}) {
  return (
    <View style={styles.trendTile}>
      <Text style={styles.trendTileLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.trendTileValue, color ? { color } : null]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.trendTileUnit}> {unit}</Text> : null}
      </Text>
      {badge ? <View style={{ marginTop: 6 }}>{badge}</View> : null}
    </View>
  );
}

/**
 * Plain-language verdict pill: "▲ Improving 6%" / "▼ Declining" / "→ Steady".
 * Already direction-aware via summarizeTrend. `neutral` shows Rose/Fell/Steady
 * without a green/red judgement (e.g. training load).
 */
function latestDisplay(values: (number | null)[], unit?: string): string {
  const value = latestVal(values);
  return value === null ? "-" : fmtValue(value, unit);
}

function TrendBadge({
  summary,
  neutral = false,
  unit,
  showMagnitude = true,
}: {
  summary: TrendSummary | null;
  neutral?: boolean;
  unit?: string;
  showMagnitude?: boolean;
}) {
  if (!summary) return <Text style={styles.badgeNoData}>NO DATA</Text>;
  const mag = fmtMagnitude(summary, unit);

  if (neutral) {
    const rose = summary.rose;
    const arrow = rose === null ? "→" : rose ? "▲" : "▼";
    const word = rose === null ? "Steady" : rose ? "Rose" : "Fell";
    return (
      <View style={[styles.badge, { backgroundColor: colors.surfaceInset }]}>
        <Text style={[styles.badgeText, { color: colors.inkMuted }]} numberOfLines={1}>
          {arrow} {word}{showMagnitude && rose !== null ? ` ${mag}` : ""}
        </Text>
      </View>
    );
  }

  const map = {
    improving: { bg: `${colors.ok}22`, fg: colors.ok, arrow: "▲", word: "Improving" },
    declining: { bg: `${colors.bad}22`, fg: colors.bad, arrow: "▼", word: "Declining" },
    steady: { bg: colors.surfaceInset, fg: colors.inkMuted, arrow: "→", word: "Steady" },
  } as const;
  const m = map[summary.dir];
  return (
    <View style={[styles.badge, { backgroundColor: m.bg }]}>
      <Text style={[styles.badgeText, { color: m.fg }]} numberOfLines={1}>
        {m.arrow} {m.word}{showMagnitude && summary.dir !== "steady" ? ` ${mag}` : ""}
      </Text>
    </View>
  );
}

/** Tiny single-series line, colored by whether the metric trends good/bad. */
function Sparkline({ values, color, height = 32 }: { values: (number | null)[]; color: string; height?: number }) {
  const [w, setW] = useState(0);
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  const nums = valid.map((p) => p.v);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 1;
  const span = Math.max(1e-6, max - min);
  const pad = 3;
  const x = (i: number) => (values.length <= 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = valid.map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(p.i)} ${y(p.v)}`).join(" ");
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && valid.length > 0 ? (
        <Svg width={w} height={height}>
          <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

/** "At a glance" footer: plain verdict + avg / best / range from the loaded series. */
function ChartInsight({
  label,
  values,
  unit = "",
  lowerIsBetter = false,
  periodDays,
}: {
  label: string;
  values: (number | null)[];
  unit?: string;
  lowerIsBetter?: boolean;
  periodDays: number;
}) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 3) return null;
  const sum = summarizeTrend(values, { lowerIsBetter });
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const best = lowerIsBetter ? min : max;
  const verdict =
    !sum || sum.dir === "steady"
      ? { word: "Steady", color: colors.inkMuted }
      : sum.dir === "improving"
      ? { word: "Improving", color: colors.ok }
      : { word: "Needs attention", color: colors.bad };
  const move =
    !sum || sum.dir === "steady"
      ? `barely changed over the last ${periodDays} days`
      : `${sum.rose ? "up" : "down"} ${fmtMagnitude(sum)} over the last ${periodDays} days`;
  const u = unit ? ` ${unit}` : "";
  return (
    <View style={styles.insightBox}>
      <Text style={styles.insightKicker}>At a glance · {label}</Text>
      <Text style={styles.insightBody}>
        <Text style={{ color: verdict.color, fontWeight: "700" }}>{verdict.word}</Text> — {move}.
      </Text>
      <View style={styles.insightStats}>
        <Text style={styles.insightStat}>Avg <Text style={styles.insightStatVal}>{fmtValue(mean)}{u}</Text></Text>
        <Text style={styles.insightStat}>Best <Text style={styles.insightStatVal}>{fmtValue(best)}{u}</Text></Text>
        <Text style={styles.insightStat}>Range <Text style={styles.insightStatVal}>{fmtValue(min)}–{fmtValue(max)}{u}</Text></Text>
      </View>
    </View>
  );
}

/** "How to read this" footer — a plain-language explainer of the chart. */
function ChartAbout({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.aboutBox}>
      <Text style={styles.insightKicker}>How to read this</Text>
      <Text style={styles.aboutBody}>{children}</Text>
    </View>
  );
}

function PerformanceTrendPanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: TrendPoint[] }>(`/api/athlete/trends?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  const readinessCol = column(series, "readiness");
  const recoveryCol = column(series, "recoveryScore");
  const loadCol = column(series, "load");
  const rSum = summarizeTrend(readinessCol);
  const recSum = summarizeTrend(recoveryCol);
  const loadSum = summarizeTrend(loadCol);

  return (
    <View style={styles.stack}>
      <ChartPanel
        title="Readiness & recovery"
        subtitle="Higher is better (0-100). Missing days show as gaps."
        action={<DaysToggle value={days} options={[7, 14, 30]} onChange={setDays} />}
        loading={loading}
      >
        <View style={styles.tileRow}>
          <TrendTile label="Readiness" value={latestDisplay(readinessCol)} color="#6bbd2a" badge={<TrendBadge summary={rSum} />} />
          <TrendTile label="Recovery" value={latestDisplay(recoveryCol)} color="#2f7df6" badge={<TrendBadge summary={recSum} />} />
        </View>
        <MultiSeriesChart
          data={series}
          series={[
            { key: "readiness", label: "Readiness", color: "#6bbd2a", kind: "line" },
            { key: "recoveryScore", label: "Recovery", color: "#2f7df6", kind: "line" },
          ]}
          leftDomain={[0, 100]}
        />
        <Legend items={[
          { label: "Readiness", color: "#6bbd2a" },
          { label: "Recovery", color: "#2f7df6" },
        ]} />
        <ChartInsight label="Readiness" values={readinessCol} periodDays={days} />
        <ChartAbout>
          Readiness and recovery both use a 0-100 score. Higher is better. Gaps mean no value was logged that day,
          not a score of zero.
        </ChartAbout>
      </ChartPanel>

      <ChartPanel
        title="Training load"
        subtitle="Higher bars mean more training stress. Blank days mean no RPE load."
        loading={loading}
      >
        <View style={styles.tileRow}>
          <TrendTile label="Latest load" value={latestDisplay(loadCol)} color="#f47c20" badge={<TrendBadge summary={loadSum} neutral />} />
        </View>
        <MultiSeriesChart
          data={series}
          series={[{ key: "load", label: "Load", color: "#f47c20", kind: "bar" }]}
          autoDomain
          height={190}
        />
        <Legend items={[{ label: "Training load", color: "#f47c20" }]} />
        <ChartAbout>
          Training load is effort from logged RPE sessions. Use it with readiness: high load during low readiness is
          the main warning sign.
        </ChartAbout>
      </ChartPanel>
    </View>
  );
}

// Each wellness signal carries its own "which way is good" so the trend reads
// correctly: more sleep/mood = better, but less stress/soreness/fatigue = better.
// Hydration rides along here (as % of the daily goal) instead of its own chart.
const WELLNESS_SIGNALS: { key: keyof WellnessPoint; label: string; lowerIsBetter: boolean; unit?: string }[] = [
  { key: "sleepQuality", label: "Sleep quality", lowerIsBetter: false },
  { key: "mood", label: "Mood", lowerIsBetter: false },
  { key: "stress", label: "Stress", lowerIsBetter: true },
  { key: "soreness", label: "Soreness", lowerIsBetter: true },
  { key: "fatigue", label: "Fatigue", lowerIsBetter: true },
  { key: "waterPct", label: "Hydration", lowerIsBetter: false, unit: "%" },
];

function WellnessSignalsPanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<WellnessPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: WellnessPoint[] }>(`/api/athlete/analytics/wellness?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <ChartPanel
      title="Wellness signals"
      subtitle="Daily self-check · trend shows if each is helping or hurting"
      action={<DaysToggle value={days} options={[14, 30]} onChange={setDays} />}
      loading={loading}
    >
      <View>
        {WELLNESS_SIGNALS.map((sig, idx) => {
          const col = column(series, sig.key);
          const sum = summarizeTrend(col, { lowerIsBetter: sig.lowerIsBetter });
          const now = latestVal(col);
          const sparkColor = !sum || sum.dir === "steady" ? colors.inkFaint : sum.dir === "improving" ? colors.ok : colors.bad;
          return (
            <View key={String(sig.key)} style={[styles.wellnessRow, idx > 0 ? styles.wellnessRowDivider : null]}>
              <View style={styles.wellnessLabelCol}>
                <Text style={styles.wellnessLabel} numberOfLines={1}>{sig.label}</Text>
                <Text style={styles.wellnessHint}>{sig.lowerIsBetter ? "lower is better" : "higher is better"}</Text>
              </View>
              <View style={styles.wellnessSpark}>
                <Sparkline values={col} color={sparkColor} />
              </View>
              <Text style={styles.wellnessValue} numberOfLines={1}>
                {now === null ? "—" : fmtValue(now)}
                <Text style={styles.wellnessUnit}>{sig.unit ?? "/5"}</Text>
              </Text>
              <View style={styles.wellnessBadge}>
                <TrendBadge summary={sum} showMagnitude={false} />
              </View>
            </View>
          );
        })}
      </View>
      <ChartAbout>
        Your daily self-check. Each row badge shows whether it is helping (green) or hurting (red) — remember higher
        is better for sleep, mood & hydration, but lower is better for stress, soreness & fatigue.
      </ChartAbout>
    </ChartPanel>
  );
}

function HeartRatePanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<WellnessPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: WellnessPoint[] }>(`/api/athlete/analytics/wellness?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  const wakeCol = column(series, "wakeHr");
  const bedCol = column(series, "bedHr");
  const wakeSum = summarizeTrend(wakeCol, { lowerIsBetter: true });
  const bedSum = summarizeTrend(bedCol);
  const hrTile = (col: (number | null)[]) => {
    const v = latestVal(col);
    return v === null ? "-" : fmtValue(v);
  };

  return (
    <ChartPanel
      title="Resting heart rate"
      subtitle="Twice daily (bpm) · a lower waking HR is better"
      action={<DaysToggle value={days} options={[7, 14, 30]} onChange={setDays} />}
      loading={loading}
    >
      <View style={styles.tileRow}>
        <TrendTile label="Waking HR" value={hrTile(wakeCol)} unit="bpm" color="#2f7df6" badge={<TrendBadge summary={wakeSum} unit="bpm" />} />
        <TrendTile label="Before bed" value={hrTile(bedCol)} unit="bpm" color="#e8892b" badge={<TrendBadge summary={bedSum} neutral unit="bpm" />} />
      </View>
      <MultiSeriesChart
        data={series}
        series={[
          { key: "wakeHr", label: "Waking HR", color: "#2f7df6", kind: "line" },
          { key: "bedHr", label: "Before bed", color: "#e8892b", kind: "line" },
        ]}
        autoDomain
      />
      <Legend items={[
        { label: "Waking HR", color: "#2f7df6" },
        { label: "Before bed", color: "#e8892b" },
      ]} />
      <ChartInsight label="Waking HR" values={wakeCol} unit="bpm" lowerIsBetter periodDays={days} />
      <ChartAbout>
        Resting heart rate on waking (blue) and before bed (amber). A lower, steady waking HR usually means good
        recovery and fitness; a sustained rise can flag fatigue, stress, or illness.
      </ChartAbout>
    </ChartPanel>
  );
}

// Time-based metrics (sprint times etc.) improve as the number goes DOWN.
const TIME_UNITS = new Set(["s", "sec", "secs", "ms", "min"]);
function lowerIsBetterMetric(metric: string | null, unit: string): boolean {
  if (TIME_UNITS.has(unit.toLowerCase())) return true;
  return /time|sprint|\b\d+\s*m\b/i.test(metric ?? "");
}

function PerformanceMetricPanel() {
  const [metric, setMetric] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [points, setPoints] = useState<PerfPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ metrics: string[]; series: PerfPoint[] }>("/api/athlete/analytics/performance?days=90")
      .then((res) => {
        setMetrics(res.metrics ?? []);
        setMetric((m) => m ?? res.metrics?.[0] ?? null);
        setPoints(res.series ?? []);
      })
      .catch(() => {
        setMetrics([]);
        setPoints([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const active = metric ?? metrics[0] ?? null;
  const data = points.filter((p) => p.metric === active).map((p) => ({ date: p.date, value: p.value }));
  const unit = points.find((p) => p.metric === active)?.unit ?? "";
  const lowerIsBetter = lowerIsBetterMetric(active, unit);
  const valueCol = data.map((p) => p.value as number | null);
  const sum = summarizeTrend(valueCol, { lowerIsBetter });
  const latestValue = latestVal(valueCol);

  return (
    <ChartPanel
      title="Performance"
      subtitle={active ? `${active}${unit ? ` (${unit})` : ""} · ${lowerIsBetter ? "lower is better" : "higher is better"}` : "Test results over time"}
      loading={loading}
    >
      {metrics.length > 1 ? <MetricToggle value={active} options={metrics} onChange={setMetric} /> : null}
      <View style={styles.latestRow}>
        <View>
          <Text style={styles.tileLabel}>Latest</Text>
          <Text style={styles.perfLatest}>{latestValue == null ? "-" : fmtValue(latestValue)}<Text style={styles.perfUnit}> {unit}</Text></Text>
        </View>
        <TrendBadge summary={sum} unit={unit} />
      </View>
      <MultiSeriesChart
        data={data}
        series={[{ key: "value", label: active ?? "value", color: "#477f17", kind: "line" }]}
        autoDomain
      />
      <ChartInsight label={active ?? "Metric"} values={valueCol} unit={unit} lowerIsBetter={lowerIsBetter} periodDays={90} />
      <ChartAbout>
        Your test results over time (last 90 days). For timed tests like sprints, lower is better; for strength and
        jumps, higher is better. Switch metric with the buttons above.
      </ChartAbout>
    </ChartPanel>
  );
}

type SessionForm = {
  status: SessionStatusValue;
  workoutType: string;
  sets: string;
  reps: string;
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

function cleanStatus(value: string | null | undefined): SessionStatusValue {
  return TRAINING_STATUS.some((s) => s.value === value) ? (value as SessionStatusValue) : "completed";
}

function categoryChoicesFor(current: string): string[] {
  return CATEGORY_CHOICES.includes(current as (typeof CATEGORY_CHOICES)[number])
    ? [...CATEGORY_CHOICES]
    : [current, ...CATEGORY_CHOICES];
}

function makeSessionForms(card: DailyCard): Record<SessionSlot, SessionForm> {
  return SESSION_SLOTS.reduce((acc, slot) => {
    const session = card.sessions[slot];
    const rpe = card.rpeEntries?.[slot] ?? null;
    acc[slot] = {
      status: cleanStatus(session.status),
      workoutType: session.workoutType ?? session.type ?? WORKOUT_TYPES[0],
      sets: session.sets == null ? "" : String(session.sets),
      reps: session.reps ?? "",
      actualDurationMin: session.actualDurationMin == null ? "" : String(session.actualDurationMin),
      effortRating: session.effortRating ?? rpe?.rpe ?? 6,
      notes: session.notes ?? "",
      trainingCategory: rpe?.trainingCategory ?? session.workoutType ?? session.type ?? TRAINING_CATEGORIES[0],
      plannedIntensityPercent: rpe?.plannedIntensityPercent ?? Math.min(100, Math.max(0, (session.intensityRpe ?? 7) * 10)),
      rpe: rpe?.rpe ?? session.effortRating ?? 6,
      sleepQuality: rpe?.sleepQuality ?? card.sleep.quality ?? 3,
      soreness: rpe?.muscleSoreness ?? card.soreness ?? 3,
      fatigue: rpe?.fatigue ?? 3,
      moodMotivation: rpe?.moodMotivation ?? 3,
      restingHeartRate: "",
    };
    return acc;
  }, {} as Record<SessionSlot, SessionForm>);
}

function sessionComplete(session: DailySession): boolean {
  return session.status === "completed" || session.status === "skipped" || session.attended === true;
}

function statusText(session: DailySession): string {
  if (session.workoutType && session.status === "completed") return `${session.workoutType} done`;
  if (session.status) return session.status.replace("_", " ");
  return session.type ? "planned" : "open";
}

function AnimatedLogProgress({ value }: { value: number }) {
  const progress = useSharedValue(value);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    progress.value = withTiming(value, { duration: 420 });
  }, [progress, value]);

  const fillStyle = useAnimatedStyle(
    () => ({ width: (width * Math.max(0, Math.min(100, progress.value))) / 100 }),
    [width]
  );

  return (
    <View style={styles.logProgressTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.logProgressFill, fillStyle]} />
    </View>
  );
}

function HydrationInline({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDay(await apiJson<WaterDay>(`/api/athlete/water?date=${date}`));
    } catch {
      // Keep the row usable even if the optional hydration fetch fails.
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(amountMl: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ date, amountMl }),
      });
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const pct = Math.min(100, Math.round((total / goal) * 100));

  return (
    <View>
      <View style={styles.hydrationHeader}>
        <Text style={styles.hydrationTotal}>
          {litres(total)}
          <Text style={styles.hydrationUnit}> / {litres(goal)} L</Text>
        </Text>
        <Text style={styles.hydrationPct}>{pct}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: total >= goal ? colors.ok : "#ff7e1a" }]} />
      </View>
      <View style={styles.quickWaterGrid}>
        {[250, 500, 750].map((ml) => (
          <Pressable key={ml} disabled={busy} onPress={() => add(ml)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>+{ml} ml</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SessionLogSection({
  card,
  wellness,
  setWellness,
  hrForm,
  setHrForm,
  recoveryModalities,
  toggleRecovery,
  noteDraft,
  setNoteDraft,
  notes,
  submitWellness,
  submitHeartRate,
  submitNote,
  postJson,
  date,
  focusedSlot,
}: {
  card: DailyCard;
  wellness: WellnessForm;
  setWellness: React.Dispatch<React.SetStateAction<WellnessForm>>;
  hrForm: { wakeHr: string; bedHr: string };
  setHrForm: React.Dispatch<React.SetStateAction<{ wakeHr: string; bedHr: string }>>;
  recoveryModalities: string[];
  toggleRecovery: (value: string) => void;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  notes: AthleteNote[];
  submitWellness: () => Promise<boolean>;
  submitHeartRate: () => Promise<boolean>;
  submitNote: () => Promise<boolean>;
  postJson: (path: string, body: unknown, success: string) => Promise<boolean>;
  date: string;
  focusedSlot: SessionSlot | null;
}) {
  const [forms, setForms] = useState<Record<SessionSlot, SessionForm>>(() => makeSessionForms(card));
  const [formError, setFormError] = useState<string | null>(null);
  const isRestDay = Boolean(card.isRestDay || card.attendance.status === "rest");
  const checkinDone = card.readinessScore !== null || card.sleep.quality !== null;
  const completedWeight = isRestDay ? 1 : SESSION_SLOTS.filter((slot) => sessionComplete(card.sessions[slot])).length;
  const requiredWeight = isRestDay ? 1 : SESSION_SLOTS.length;
  const progress = requiredWeight ? (completedWeight / requiredWeight) * 100 : 100;
  const firstSession = SESSION_SLOTS.find((slot) => !sessionComplete(card.sessions[slot]));
  const firstUnfinished = firstSession ? `session:${firstSession}` : null;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<SessionSlot>(focusedSlot ?? firstSession ?? SESSION_SLOTS[0]);
  const hrDone = card.heartRate.wakeHr !== null || card.heartRate.bedHr !== null;
  const recDone = card.recovery.score !== null || !!card.recovery.status;
  const notesDone = notes.length > 0;

  useEffect(() => {
    setForms(makeSessionForms(card));
  }, [card]);

  useEffect(() => {
    setActiveSlot(focusedSlot ?? firstSession ?? SESSION_SLOTS[0]);
    setOpenKey(null);
  }, [date, focusedSlot]);

  useEffect(() => {
    if (focusedSlot) setActiveSlot(focusedSlot);
  }, [focusedSlot]);

  function toggle(key: string) {
    setOpenKey((cur) => (cur === key ? null : key));
  }

  function updateSession(slot: SessionSlot, patch: Partial<SessionForm>) {
    setForms((current) => ({ ...current, [slot]: { ...current[slot], ...patch } }));
  }

  function numberField(raw: string, label: string, min: number, max: number): number | undefined | false {
    if (!raw.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      setFormError(`${label} must be ${min}-${max}.`);
      return false;
    }
    return value;
  }

  async function saveSession(slot: SessionSlot) {
    setFormError(null);
    const form = forms[slot];
    const actualDurationMin = numberField(form.actualDurationMin, "Duration", 0, 600);
    if (actualDurationMin === false) return false;
    const restingHeartRate = numberField(form.restingHeartRate, "Resting heart rate", 20, 220);
    if (restingHeartRate === false) return false;
    const trainingCategory = (TRAINING_CATEGORIES as readonly string[]).includes(form.workoutType)
      ? form.workoutType
      : form.trainingCategory;

    const trainingPayload: Record<string, unknown> = {
      date,
      status: form.status,
      workoutType: form.workoutType,
      effortRating: form.effortRating,
      notes: form.notes,
    };
    if (form.status === "completed") trainingPayload.attended = true;
    if (form.status === "skipped") trainingPayload.attended = false;
    if (actualDurationMin !== undefined) trainingPayload.actualDurationMin = actualDurationMin;

    const savedTraining = await postJson(
      `/api/athlete/training/${slot}`,
      trainingPayload,
      `${SLOT_LABEL[slot]} session saved.`
    );
    if (!savedTraining || form.status === "skipped") return savedTraining;

    return postJson(
      "/api/athlete/rpe-monitoring",
      {
        date,
        sessionType: slot,
        trainingCategory,
        plannedIntensityPercent: form.plannedIntensityPercent,
        rpe: form.rpe,
        sleepQuality: form.sleepQuality,
        muscleSoreness: form.soreness,
        fatigue: form.fatigue,
        moodMotivation: form.moodMotivation,
        ...(restingHeartRate !== undefined ? { restingHeartRate } : {}),
      },
      `${SLOT_LABEL[slot]} RPE logged.`
    );
  }

  const checkinStatus = card.readinessScore !== null ? `Readiness ${card.readinessScore}` : checkinDone ? "Logged" : "Required";
  const progressDone = progress >= 100;
  const activeSession = card.sessions[activeSlot];
  const activeForm = forms[activeSlot];
  const activeRpe = card.rpeEntries?.[activeSlot] ?? null;
  const activeDone = isRestDay || sessionComplete(activeSession);

  return (
    <View style={styles.stack}>
      <Card style={styles.logHub}>
        <View style={styles.logHubHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <CardTitle>Today's log</CardTitle>
            <View style={styles.logProgressLine}>
              <AnimatedLogProgress value={progress} />
              <Text style={[styles.logProgressText, progressDone ? styles.logProgressTextDone : null]}>
                {progress.toFixed(1)}%
              </Text>
            </View>
          </View>
          <View style={[styles.logProgressPill, progressDone ? styles.logProgressPillDone : null]}>
            <Text style={[styles.logProgressText, progressDone ? styles.logProgressTextDone : null]}>
              {progressDone ? "Done" : `${completedWeight}/${requiredWeight}`}
            </Text>
          </View>
        </View>

        <View style={styles.restDayPanel}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.restDayTitle}>Rest day</Text>
            <Text style={styles.restDayText}>Sessions pause; check-in and recovery stay available.</Text>
          </View>
          <Pressable
            onPress={() =>
              postJson(
                "/api/athlete/rest-day",
                { date, enabled: !isRestDay },
                isRestDay ? "Rest day cleared." : "Rest day saved."
              )
            }
            style={[styles.restToggle, isRestDay ? styles.restToggleOn : null]}
            accessibilityRole="switch"
            accessibilityState={{ checked: isRestDay }}
          >
            <Ionicons name={isRestDay ? "moon" : "moon-outline"} size={16} color={isRestDay ? theme.accentInk : colors.inkMuted} />
          </Pressable>
        </View>

        <View style={styles.sessionTabs}>
          {SESSION_SLOTS.map((slot) => {
            const session = card.sessions[slot];
            const rpe = card.rpeEntries?.[slot] ?? null;
            const selected = activeSlot === slot;
            const done = isRestDay || Boolean(rpe) || sessionComplete(session);
            const title = isRestDay ? "Rest day" : session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Training";
            return (
              <Pressable
                key={slot}
                onPress={() => setActiveSlot(slot)}
                style={[styles.sessionTab, selected ? styles.sessionTabActive : null, done ? styles.sessionTabDone : null]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.sessionTabLabel, selected ? styles.sessionTabLabelActive : null]}>{SLOT_LABEL[slot]}</Text>
                <Text style={styles.sessionTabTitle} numberOfLines={1}>{title}</Text>
                <Text style={styles.sessionTabMeta}>{done ? "Done" : "Open"}</Text>
              </Pressable>
            );
          })}
        </View>

        {isRestDay ? (
          <View style={styles.sessionFormPanel}>
            <Text style={styles.sessionFormTitle}>Rest day is on</Text>
            <Text style={styles.miniMuted}>AM, Afternoon, and PM training inputs are paused for this date.</Text>
          </View>
        ) : (
          <View style={styles.sessionFormPanel}>
            <View style={styles.sessionMetaRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sessionFormTitle}>{SLOT_LABEL[activeSlot]} session</Text>
                <Text style={styles.miniMuted}>
                  Planned: {activeSession.type ?? "open"}
                  {activeSession.durationMin ? ` - ${activeSession.durationMin} min` : ""}
                </Text>
              </View>
              {activeRpe ? <Chip band={activeRpe.riskFlag}>{activeRpe.riskFlag}</Chip> : null}
            </View>

            <Text style={styles.inputLabel}>Completion</Text>
            <View style={styles.choiceGrid}>
              {TRAINING_STATUS.map((o) => (
                <Choice
                  key={o.value}
                  label={o.label}
                  selected={activeForm.status === o.value}
                  onPress={() => updateSession(activeSlot, { status: o.value })}
                />
              ))}
            </View>

            <Text style={[styles.inputLabel, { marginTop: 14 }]}>Workout</Text>
            <View style={styles.recoveryWrap}>
              {WORKOUT_TYPES.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => updateSession(activeSlot, { workoutType: item, trainingCategory: item })}
                  style={[styles.trainingChip, activeForm.workoutType === item ? styles.trainingChipOn : null]}
                >
                  <Text style={[styles.trainingText, activeForm.workoutType === item ? styles.trainingTextOn : null]}>{item}</Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.twoCols, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Duration</Text>
                <TextField
                  value={activeForm.actualDurationMin}
                  onChangeText={(v) => updateSession(activeSlot, { actualDurationMin: v })}
                  placeholder="min"
                  keyboardType="number-pad"
                  style={styles.compactField}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Resting HR</Text>
                <TextField
                  value={activeForm.restingHeartRate}
                  onChangeText={(v) => updateSession(activeSlot, { restingHeartRate: v })}
                  placeholder="optional"
                  keyboardType="number-pad"
                  style={styles.compactField}
                />
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              <CompactScale label="Effort" value={activeForm.effortRating} onChange={(v) => updateSession(activeSlot, { effortRating: v, rpe: v })} lowHint="Easy" highHint="Max" min={1} max={10} />
            </View>
            <View style={{ marginTop: 12 }}>
              <CompactScale label="Planned intensity" value={activeForm.plannedIntensityPercent} onChange={(v) => updateSession(activeSlot, { plannedIntensityPercent: v })} lowHint="0%" highHint="100%" min={0} max={100} />
            </View>
            <View style={{ marginTop: 12 }}>
              <CompactScale label="Session RPE" value={activeForm.rpe} onChange={(v) => updateSession(activeSlot, { rpe: v, effortRating: v })} lowHint="Rest" highHint="Max" min={0} max={10} />
            </View>

            <View style={[styles.twoCols, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <CompactScale label="Sleep" value={activeForm.sleepQuality} onChange={(v) => updateSession(activeSlot, { sleepQuality: v })} lowHint="Poor" highHint="Great" />
              </View>
              <View style={{ flex: 1 }}>
                <CompactScale label="Mood" value={activeForm.moodMotivation} onChange={(v) => updateSession(activeSlot, { moodMotivation: v })} lowHint="Low" highHint="High" />
              </View>
            </View>

            <View style={[styles.twoCols, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <CompactScale label="Soreness" value={activeForm.soreness} onChange={(v) => updateSession(activeSlot, { soreness: v })} lowHint="Fresh" highHint="Sore" />
              </View>
              <View style={{ flex: 1 }}>
                <CompactScale label="Fatigue" value={activeForm.fatigue} onChange={(v) => updateSession(activeSlot, { fatigue: v })} lowHint="Rested" highHint="Spent" />
              </View>
            </View>

            <TextInput
              value={activeForm.notes}
              onChangeText={(v) => updateSession(activeSlot, { notes: v })}
              placeholder="Session notes"
              placeholderTextColor={colors.inkFaint}
              multiline
              style={[styles.noteBox, { marginTop: 12 }]}
            />
            {activeRpe ? (
              <Text style={[styles.miniMuted, { marginTop: 8 }]}>
                Load {activeRpe.calculatedTrainingLoad} - readiness {activeRpe.readinessScore ?? "-"}
              </Text>
            ) : null}
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <View style={{ marginTop: 12 }}>
              <CompactButton label={`Save ${SLOT_LABEL[activeSlot]}`} onPress={() => saveSession(activeSlot)} successLabel="Saved" />
            </View>
          </View>
        )}

        {false ? (
          <>
        <LogRow title="Daily check-in" status={checkinStatus} done={checkinDone} open={openKey === "checkin"} onToggle={() => toggle("checkin")}>
          <Text style={styles.inputLabel}>Sleep hours</Text>
          <TextField
            value={wellness.sleepHours}
            onChangeText={(v) => setWellness((s) => ({ ...s, sleepHours: v }))}
            placeholder="e.g. 8"
            keyboardType="decimal-pad"
            style={styles.compactField}
          />
          <View style={{ height: 12 }} />
          {[
            ["sleepQuality", "Sleep quality", "Poor", "Great"],
            ["mood", "Mood", "Low", "High"],
            ["stress", "Stress", "Calm", "Tense"],
            ["soreness", "Soreness", "Fresh", "Sore"],
            ["fatigue", "Fatigue", "Rested", "Spent"],
          ].map(([key, label, low, high]) => (
            <View key={key} style={{ marginBottom: 10 }}>
              <CompactScale
                label={label}
                value={Number(wellness[key as keyof WellnessForm])}
                onChange={(v) => setWellness((s) => ({ ...s, [key]: String(v) }))}
                lowHint={low}
                highHint={high}
              />
            </View>
          ))}
          <CompactButton label="Save check-in" onPress={submitWellness} successLabel="Saved" />
        </LogRow>

        {SESSION_SLOTS.map((slot) => {
          const session = card.sessions[slot];
          const done = isRestDay || sessionComplete(session);
          const form = forms[slot];
          const rpe = card.rpeEntries?.[slot] ?? null;
          return (
            <LogRow
              key={slot}
              title={`${SLOT_LABEL[slot]} session`}
              status={isRestDay ? "Rest day" : statusText(session)}
              done={done}
              open={!isRestDay && openKey === `session:${slot}`}
              onToggle={() => (isRestDay ? undefined : toggle(`session:${slot}`))}
            >
              <View style={styles.sessionMetaRow}>
                <Text style={styles.miniMuted}>
                  Planned: {session.type ?? "open"}
                  {session.durationMin ? ` · ${session.durationMin} min` : ""}
                </Text>
                {rpe ? <Chip band={rpe.riskFlag}>{rpe.riskFlag}</Chip> : null}
              </View>

              <Text style={styles.inputLabel}>Completion</Text>
              <View style={styles.choiceGrid}>
                {TRAINING_STATUS.map((o) => (
                  <Choice key={o.value} label={o.label} selected={form.status === o.value} onPress={() => updateSession(slot, { status: o.value })} />
                ))}
              </View>

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Workout</Text>
              <View style={styles.recoveryWrap}>
                {WORKOUT_TYPES.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => updateSession(slot, { workoutType: item })}
                    style={[styles.trainingChip, form.workoutType === item ? styles.trainingChipOn : null]}
                  >
                    <Text style={[styles.trainingText, form.workoutType === item ? styles.trainingTextOn : null]}>{item}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Sets</Text>
                  <TextField value={form.sets} onChangeText={(v) => updateSession(slot, { sets: v })} placeholder="e.g. 4" keyboardType="number-pad" style={styles.compactField} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Reps / distance</Text>
                  <TextField value={form.reps} onChangeText={(v) => updateSession(slot, { reps: v })} placeholder="100m" style={styles.compactField} />
                </View>
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Duration</Text>
                  <TextField value={form.actualDurationMin} onChangeText={(v) => updateSession(slot, { actualDurationMin: v })} placeholder="min" keyboardType="number-pad" style={styles.compactField} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Resting HR</Text>
                  <TextField value={form.restingHeartRate} onChangeText={(v) => updateSession(slot, { restingHeartRate: v })} placeholder="optional" keyboardType="number-pad" style={styles.compactField} />
                </View>
              </View>

              <View style={{ marginTop: 12 }}>
                <CompactScale label="Effort" value={form.effortRating} onChange={(v) => updateSession(slot, { effortRating: v, rpe: v })} lowHint="Easy" highHint="Max" min={1} max={10} />
              </View>

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>RPE category</Text>
              <View style={styles.recoveryWrap}>
                {categoryChoicesFor(form.trainingCategory).map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => updateSession(slot, { trainingCategory: category })}
                    style={[styles.trainingChip, form.trainingCategory === category ? styles.trainingChipOn : null]}
                  >
                    <Text style={[styles.trainingText, form.trainingCategory === category ? styles.trainingTextOn : null]}>{category}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ marginTop: 12 }}>
                <CompactScale label="Planned intensity" value={form.plannedIntensityPercent} onChange={(v) => updateSession(slot, { plannedIntensityPercent: v })} lowHint="0%" highHint="100%" min={0} max={100} />
              </View>
              <View style={{ marginTop: 12 }}>
                <CompactScale label="Session RPE" value={form.rpe} onChange={(v) => updateSession(slot, { rpe: v, effortRating: v })} lowHint="Rest" highHint="Max" min={0} max={10} />
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Soreness" value={form.soreness} onChange={(v) => updateSession(slot, { soreness: v })} lowHint="Fresh" highHint="Sore" />
                </View>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Fatigue" value={form.fatigue} onChange={(v) => updateSession(slot, { fatigue: v })} lowHint="Rested" highHint="Spent" />
                </View>
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Sleep" value={form.sleepQuality} onChange={(v) => updateSession(slot, { sleepQuality: v })} lowHint="Poor" highHint="Great" />
                </View>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Mood" value={form.moodMotivation} onChange={(v) => updateSession(slot, { moodMotivation: v })} lowHint="Low" highHint="High" />
                </View>
              </View>

              <TextInput
                value={form.notes}
                onChangeText={(v) => updateSession(slot, { notes: v })}
                placeholder="Optional session notes"
                placeholderTextColor={colors.inkFaint}
                multiline
                style={[styles.noteBox, { marginTop: 12 }]}
              />
              {rpe ? (
                <Text style={[styles.miniMuted, { marginTop: 8 }]}>
                  Load {rpe.calculatedTrainingLoad} · readiness {rpe.readinessScore ?? "-"}
                </Text>
              ) : null}
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}
              <View style={{ marginTop: 12 }}>
                <CompactButton label="Save session" onPress={() => saveSession(slot)} successLabel="Saved" />
              </View>
            </LogRow>
          );
        })}

        <LogRow title="Hydration" status="Optional" done={false} open={openKey === "hydration"} onToggle={() => toggle("hydration")}>
          <HydrationInline date={date} />
        </LogRow>
          </>
        ) : null}

        <LogRow title="Heart rate" status={hrDone ? `${card.heartRate.wakeHr ?? "-"} / ${card.heartRate.bedHr ?? "-"} bpm` : "Optional"} done={hrDone} open={openKey === "heart"} onToggle={() => toggle("heart")}>
          <Muted style={{ marginBottom: 10 }}>Resting bpm - log on waking and before bed.</Muted>
          <View style={styles.twoCols}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Waking HR</Text>
              <TextField value={hrForm.wakeHr} onChangeText={(v) => setHrForm((s) => ({ ...s, wakeHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Before bed</Text>
              <TextField value={hrForm.bedHr} onChangeText={(v) => setHrForm((s) => ({ ...s, bedHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton label="Save heart rate" onPress={submitHeartRate} successLabel="Saved" />
          </View>
        </LogRow>

        {false ? (
        <LogRow title="Recovery" status={recDone ? card.recovery.status ?? `${card.recovery.score}` : "Optional"} done={recDone} open={openKey === "recovery"} onToggle={() => toggle("recovery")}>
          <View style={styles.recoveryWrap}>
            {RECOVERY_OPTIONS.map((item) => {
              const value = item.toLowerCase().replace(/\s+/g, "_");
              const on = recoveryModalities.includes(value);
              return (
                <Pressable key={item} onPress={() => toggleRecovery(value)} style={[styles.recoveryChip, on ? styles.recoveryChipOn : null]}>
                  <Text style={[styles.recoveryText, on ? styles.recoveryTextOn : null]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton label="Save recovery" onPress={() => postJson("/api/athlete/recovery", { date, modalities: recoveryModalities }, "Recovery saved.")} successLabel="Saved" />
          </View>
        </LogRow>
        ) : null}

        <LogRow title="Daily notes" status={notesDone ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Optional"} done={notesDone} open={openKey === "notes"} onToggle={() => toggle("notes")}>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="Anything to log today?"
            placeholderTextColor={colors.inkFaint}
            multiline
            style={styles.noteBox}
          />
          <View style={{ marginTop: 10 }}>
            <CompactButton label="Save note" onPress={submitNote} disabled={!noteDraft.trim()} successLabel="Saved" />
          </View>
          {notes.length > 0 ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {notes.map((n) => (
                <View key={n._id} style={styles.noteItem}>
                  <Text style={styles.noteText}>{n.body}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.miniMuted, { marginTop: 10 }]}>No notes today.</Text>
          )}
        </LogRow>
      </Card>
    </View>
  );
}

function LogSection({
  card,
  wellness,
  setWellness,
  hrForm,
  setHrForm,
  recoveryModalities,
  toggleRecovery,
  noteDraft,
  setNoteDraft,
  notes,
  submitWellness,
  submitHeartRate,
  submitNote,
  postJson,
  date,
}: {
  card: DailyCard;
  wellness: WellnessForm;
  setWellness: React.Dispatch<React.SetStateAction<WellnessForm>>;
  hrForm: { wakeHr: string; bedHr: string };
  setHrForm: React.Dispatch<React.SetStateAction<{ wakeHr: string; bedHr: string }>>;
  recoveryModalities: string[];
  toggleRecovery: (value: string) => void;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  notes: AthleteNote[];
  submitWellness: () => Promise<boolean>;
  submitHeartRate: () => Promise<boolean>;
  submitNote: () => Promise<boolean>;
  postJson: (path: string, body: unknown, success: string) => Promise<boolean>;
  date: string;
}) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Per-entry "done" state drives the at-a-glance checklist + progress count.
  const checkinDone = card.readinessScore !== null || card.sleep.quality !== null;
  const attDone = !!card.attendance.status;
  const loggedSlots = SESSION_SLOTS.filter((s) => card.sessions[s].status);
  const trainDone = loggedSlots.length > 0;
  const hr = card.heartRate;
  const hrDone = hr.wakeHr !== null || hr.bedHr !== null;
  const recDone = card.recovery.score !== null || !!card.recovery.status;
  const notesDone = notes.length > 0;

  const ENTRIES = [checkinDone, attDone, trainDone, hrDone, recDone, notesDone];
  const doneCount = ENTRIES.filter(Boolean).length;
  const keys = ["checkin", "attendance", "training", "heart", "recovery", "notes"];
  const firstUnfinished = keys[ENTRIES.findIndex((d) => !d)] ?? null;

  const [openKey, setOpenKey] = useState<string | null>(firstUnfinished);
  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));

  const checkinStatus = card.readinessScore !== null ? `Readiness ${card.readinessScore}` : checkinDone ? "Logged" : "Not logged";
  const attStatus = card.attendance.status ? cap(card.attendance.status) : "Not logged";
  const trainStatus = trainDone ? `${loggedSlots.length}/${SESSION_SLOTS.length} logged` : "Not logged";
  const hrStatus = hrDone ? `${hr.wakeHr ?? "–"} / ${hr.bedHr ?? "–"} bpm` : "Not logged";
  const recStatus = card.recovery.status ? cap(card.recovery.status) : recDone ? `${card.recovery.score}` : "Not logged";
  const notesStatus = notesDone ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Not logged";

  return (
    <View style={styles.stack}>
      <Card style={styles.logHub}>
        <View style={styles.logHubHead}>
          <CardTitle>Today's log</CardTitle>
          <View style={[styles.logProgressPill, doneCount === 6 ? styles.logProgressPillDone : null]}>
            <Text style={[styles.logProgressText, doneCount === 6 ? styles.logProgressTextDone : null]}>
              {doneCount === 6 ? "All done" : `${doneCount} of 6 done`}
            </Text>
          </View>
        </View>

        <LogRow title="Daily check-in" status={checkinStatus} done={checkinDone} open={openKey === "checkin"} onToggle={() => toggle("checkin")}>
          <Text style={styles.inputLabel}>Sleep hours</Text>
          <TextField
            value={wellness.sleepHours}
            onChangeText={(v) => setWellness((s) => ({ ...s, sleepHours: v }))}
            placeholder="e.g. 8"
            keyboardType="decimal-pad"
            style={styles.compactField}
          />
          <View style={{ height: 12 }} />
          {[
            ["sleepQuality", "Sleep quality", "Poor", "Great"],
            ["mood", "Mood", "Low", "High"],
            ["stress", "Stress", "Calm", "Tense"],
            ["soreness", "Soreness", "Fresh", "Sore"],
            ["fatigue", "Fatigue", "Rested", "Spent"],
          ].map(([key, label, low, high]) => (
            <View key={key} style={{ marginBottom: 10 }}>
              <CompactScale
                label={label}
                value={Number(wellness[key as keyof WellnessForm])}
                onChange={(v) => setWellness((s) => ({ ...s, [key]: String(v) }))}
                lowHint={low}
                highHint={high}
              />
            </View>
          ))}
          <CompactButton label="Save check-in" onPress={submitWellness} successLabel="Saved" />
        </LogRow>

        <LogRow title="Attendance" status={attStatus} done={attDone} open={openKey === "attendance"} onToggle={() => toggle("attendance")}>
          <View style={styles.choiceGrid}>
            {ATTENDANCE.map((o) => (
              <Choice
                key={o.value}
                label={o.label}
                selected={card.attendance.status === o.value}
                onPress={() => postJson("/api/athlete/attendance", { date, status: o.value }, `Attendance: ${o.value}.`)}
              />
            ))}
          </View>
        </LogRow>

        <LogRow title="Training completion" status={trainStatus} done={trainDone} open={openKey === "training"} onToggle={() => toggle("training")}>
          <View style={styles.stackSmall}>
            {SESSION_SLOTS.map((slot) => (
              <View key={slot}>
                <Text style={styles.tileLabel}>{SLOT_LABEL[slot]}{card.sessions[slot].type ? ` · ${card.sessions[slot].type}` : ""}</Text>
                <View style={[styles.choiceGrid, { marginTop: 6 }]}>
                  {TRAINING_STATUS.map((o) => (
                    <Choice
                      key={o.value}
                      label={o.label}
                      selected={card.sessions[slot].status === o.value}
                      onPress={() => postJson(`/api/athlete/training/${slot}`, { date, status: o.value }, `${slot} session: ${o.value}.`)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        </LogRow>

        <LogRow title="Heart rate" status={hrStatus} done={hrDone} open={openKey === "heart"} onToggle={() => toggle("heart")}>
          <Muted style={{ marginBottom: 10 }}>Resting bpm - log on waking and before bed.</Muted>
          <View style={styles.twoCols}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Waking HR</Text>
              <TextField value={hrForm.wakeHr} onChangeText={(v) => setHrForm((s) => ({ ...s, wakeHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Before bed</Text>
              <TextField value={hrForm.bedHr} onChangeText={(v) => setHrForm((s) => ({ ...s, bedHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton label="Save heart rate" onPress={submitHeartRate} successLabel="Saved" />
          </View>
        </LogRow>

        <LogRow title="Recovery" status={recStatus} done={recDone} open={openKey === "recovery"} onToggle={() => toggle("recovery")}>
          <View style={styles.recoveryWrap}>
            {RECOVERY_OPTIONS.map((item) => (
              <Pressable
                key={item}
                onPress={() => toggleRecovery(item.toLowerCase().replace(/\s+/g, "_"))}
                style={[
                  styles.recoveryChip,
                  recoveryModalities.includes(item.toLowerCase().replace(/\s+/g, "_")) ? styles.recoveryChipOn : null,
                ]}
              >
                <Text style={[
                  styles.recoveryText,
                  recoveryModalities.includes(item.toLowerCase().replace(/\s+/g, "_")) ? styles.recoveryTextOn : null,
                ]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton
              label="Save recovery"
              onPress={() => postJson("/api/athlete/recovery", { date, modalities: recoveryModalities }, "Recovery saved.")}
              successLabel="Saved"
            />
          </View>
        </LogRow>

        <LogRow title="Daily notes" status={notesStatus} done={notesDone} open={openKey === "notes"} onToggle={() => toggle("notes")}>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="Anything to log today?"
            placeholderTextColor={colors.inkFaint}
            multiline
            style={styles.noteBox}
          />
          <View style={{ marginTop: 10 }}>
            <CompactButton label="Save note" onPress={submitNote} disabled={!noteDraft.trim()} successLabel="Saved" />
          </View>
          {notes.length > 0 ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {notes.map((n) => (
                <View key={n._id} style={styles.noteItem}>
                  <Text style={styles.noteText}>{n.body}</Text>
                </View>
              ))}
            </View>
          ) : <Text style={[styles.miniMuted, { marginTop: 10 }]}>No notes today.</Text>}
        </LogRow>
      </Card>
    </View>
  );
}

function LogRow({
  title,
  status,
  done,
  open,
  onToggle,
  children,
}: {
  title: string;
  status: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.logRowWrap}>
      <Pressable onPress={onToggle} style={styles.logRow}>
        <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={20} color={done ? colors.ok : colors.inkFaint} />
        <Text style={styles.logRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={[styles.logRowStatus, done ? styles.logRowStatusDone : null]} numberOfLines={1}>{status}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.inkFaint} />
      </Pressable>
      {open ? <View style={styles.logRowBody}>{children}</View> : null}
    </View>
  );
}

function CoachSection({
  announcements,
  coachComments,
  coachCount,
  activity,
}: {
  announcements: TeamAnnouncement[];
  coachComments: CoachComment[];
  coachCount: number | null;
  activity: FeedItem[];
}) {
  return (
    <View style={styles.stack}>
      <Card>
        <CardTitle>Coach updates</CardTitle>
        {announcements.length === 0 ? (
          <Text style={styles.miniMuted}>{coachCount === 0 ? "No coach linked yet. Your personal logs still work here." : "No coach announcements yet."}</Text>
        ) : (
          <View style={styles.stackSmall}>
            {announcements.map((a) => (
              <View key={a.id} style={styles.accentItem}>
                <Text style={styles.itemBody}>{a.body}</Text>
                <Text style={styles.itemMeta}>{a.coachName} · {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>Coach feedback</CardTitle>
        {coachComments.length === 0 ? (
          <Text style={styles.miniMuted}>{coachCount === 0 ? "Coach feedback appears here after a coach links your profile." : "No coach feedback today."}</Text>
        ) : (
          <View style={styles.stackSmall}>
            {coachComments.map((c) => (
              <View key={c._id} style={styles.insetItem}>
                <Text style={styles.itemBody}>{c.body}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>Recent activity</CardTitle>
        <TimelineFeed items={activity.slice(0, 10)} />
      </Card>
    </View>
  );
}

function relativeDate(at: string): string {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return at.slice(5, 10);
}

function feedDotColor(item: FeedItem): string {
  if (item.band) return bandColor(item.band);
  if (item.kind === "comment" || item.kind === "note") return theme.accentStrong;
  return colors.inkFaint;
}

function TimelineFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) return <Text style={styles.miniMuted}>No recent activity.</Text>;
  return (
    <View style={styles.timeline}>
      <View style={styles.timelineLine} />
      {items.map((item) => {
        const dot = feedDotColor(item);
        const detail = item.detail ?? item.subtitle;
        return (
          <View key={item.id} style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: dot, shadowColor: dot }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.timelineTitleRow}>
                <Text style={styles.timelineTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.timelineTime}>{relativeDate(item.at)}</Text>
              </View>
              {detail ? <Text style={styles.timelineDetail} numberOfLines={1}>{detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function chatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function chatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function AthleteMessagesPanel({
  initialCoachId,
  onHeaderChange,
}: {
  initialCoachId: string | null;
  onHeaderChange: (header: MessageHeader) => void;
}) {
  const [coaches, setCoaches] = useState<AssignedCoach[]>([]);
  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCoachId);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(false);

  const parties = useMemo<MessageParty[]>(() => {
    const coachById = new Map(coaches.map((coach) => [coach.coachId, coach]));
    const threadIds = new Set(threads.map((thread) => thread.partyId));
    const threadParties = threads.map((thread) => ({
      id: thread.partyId,
      name: thread.partyName || coachById.get(thread.partyId)?.name || "Coach",
      subtitle: "Coach",
      lastMessage: thread.lastMessage,
      lastAt: thread.lastAt,
      lastSenderRole: thread.lastSenderRole,
      unreadCount: thread.unreadCount,
    }));
    const starters = coaches
      .filter((coach) => !threadIds.has(coach.coachId))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((coach) => ({ id: coach.coachId, name: coach.name || "Coach", subtitle: "Coach" }));
    return [...threadParties, ...starters];
  }, [coaches, threads]);
  const selectedParty = parties.find((party) => party.id === selectedId) ?? null;

  useEffect(() => {
    onHeaderChange({
      title: showList || !selectedParty ? "Messages" : selectedParty.name,
      subtitle: showList || !selectedParty ? "Direct coach chat" : "Direct message",
    });
  }, [onHeaderChange, selectedParty, showList]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [coachRes, threadRes] = await Promise.all([
        apiJson<{ coaches: AssignedCoach[] }>("/api/athlete/coaches"),
        apiJson<{ threads: MessageThreadSummary[] }>("/api/athlete/messages/threads"),
      ]);
      setCoaches(coachRes.coaches ?? []);
      setThreads(threadRes.threads ?? []);
    } catch {
      setError("Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setThreadLoading(true);
    setThreadError(null);
    try {
      const res = await apiJson<{ messages: MessageView[]; hasMore: boolean }>(
        `/api/athlete/messages/${selectedId}?limit=50`
      );
      setMessages(res.messages ?? []);
      setThreads((prev) =>
        prev.map((thread) => (thread.partyId === selectedId ? { ...thread, unreadCount: 0 } : thread))
      );
      await apiFetch(`/api/athlete/messages/${selectedId}/read`, { method: "POST" }).catch(() => undefined);
    } catch {
      setMessages([]);
      setThreadError("Couldn't load this conversation.");
    } finally {
      setThreadLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialCoachId) setSelectedId(initialCoachId);
  }, [initialCoachId]);

  useEffect(() => {
    if (!selectedId && parties.length > 0) setSelectedId(parties[0].id);
  }, [parties, selectedId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!selectedParty && parties.length > 0) return;
    setShowList(false);
  }, [parties.length, selectedParty]);

  async function send() {
    const coachId = selectedId;
    const body = draft.trim();
    if (!coachId || !body) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await apiFetch(`/api/athlete/messages/${coachId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: MessageView };
      if (!res.ok || !payload.message) {
        setThreadError("Message was not sent. Try again.");
        return;
      }
      setDraft("");
      setMessages((prev) => [...prev, payload.message!]);
      await load();
    } catch {
      setThreadError("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  const canSend = Boolean(selectedId && draft.trim() && !sending);

  return (
    <View style={styles.directChat}>
      <View style={styles.directTopRow}>
        <Pressable
          onPress={() => {
            if (showList) setShowList(false);
            else setShowList(true);
          }}
          style={styles.directBack}
          accessibilityLabel={showList ? "Back to conversation" : "Back to messages"}
        >
          <Ionicons name="arrow-back" size={18} color={colors.inkMuted} />
        </Pressable>
      </View>

      {showList ? (
        <ScrollView contentContainerStyle={styles.threadPickerList}>
          {loading ? <ActivityIndicator color={theme.accentStrong} /> : null}
          {error ? <Text style={styles.directError}>{error}</Text> : null}
          {!loading && parties.length === 0 ? <Text style={styles.emptyText}>No coach linked yet.</Text> : null}
          {parties.map((party) => (
            <Pressable
              key={party.id}
              onPress={() => {
                setSelectedId(party.id);
                setShowList(false);
              }}
              style={[styles.threadPickerItem, party.id === selectedId ? styles.threadPickerItemOn : null]}
            >
              <View style={[styles.threadAvatar, party.id === selectedId ? styles.threadAvatarOn : null]}>
                <Text style={[styles.threadAvatarText, party.id === selectedId ? styles.threadAvatarTextOn : null]}>
                  {(party.name || "C").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.threadName} numberOfLines={1}>{party.name}</Text>
                <Text style={styles.threadMeta} numberOfLines={1}>{party.lastMessage || party.subtitle || "Coach"}</Text>
              </View>
              {party.unreadCount ? <View style={styles.threadUnread} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <>
          <View style={styles.directThread}>
            {threadLoading || (loading && parties.length === 0) ? (
              <ActivityIndicator color={theme.accentStrong} />
            ) : error && parties.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{error}</Text>
              </View>
            ) : !selectedParty ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No coach linked yet.</Text>
              </View>
            ) : messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySub}>Say hello to start the conversation.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.directMessageList}>
                {messages.map((message, index) => {
                  const prev = messages[index - 1];
                  const showDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                  return (
                    <View key={message.id}>
                      {showDay ? <Text style={styles.dayMarker}>{chatDay(message.createdAt)}</Text> : null}
                      <View style={[styles.messageRow, message.mine ? styles.messageRowMine : null]}>
                        <View style={[styles.messageBubble, message.mine ? styles.messageBubbleMine : styles.messageBubbleOther]}>
                          <Text style={[styles.messageBody, message.mine ? styles.messageBodyMine : null]}>{message.body}</Text>
                          <Text style={[styles.messageTime, message.mine ? styles.messageTimeMine : null]}>{chatTime(message.createdAt)}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {threadError ? <Text style={styles.directError}>{threadError}</Text> : null}

          {selectedParty ? (
            <View style={styles.directComposer}>
              <TextInput
                value={draft}
                onChangeText={(value) => setDraft(value.slice(0, 4000))}
                placeholder="Message..."
                placeholderTextColor={colors.inkFaint}
                multiline
                style={styles.directInput}
              />
              <Pressable
                onPress={send}
                disabled={!canSend}
                style={[styles.directSend, !canSend ? styles.directSendOff : null]}
                accessibilityLabel="Send message"
              >
                <Ionicons name="send" size={18} color={canSend ? theme.accentInk : colors.inkFaint} />
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

function Chip({ band, children, style }: { band: Band; children: React.ReactNode; style?: object }) {
  const color = bandColor(band);
  return (
    <View style={[styles.chip, { backgroundColor: `${color}22` }, style]}>
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected ? styles.choiceOn : null]}>
      <Text style={[styles.choiceText, selected ? styles.choiceTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

function CompactButton({
  label,
  onPress,
  disabled,
  successLabel,
  successDurationMs = 1600,
}: {
  label: string;
  onPress: () => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  successLabel?: string;
  successDurationMs?: number;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const off = disabled || phase === "busy" || phase === "done";

  async function handlePress() {
    const result = onPress();
    const isPromise = !!result && typeof (result as { then?: unknown }).then === "function";
    if (!successLabel || !isPromise) return;
    setPhase("busy");
    let ok = true;
    try {
      ok = (await result) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      setPhase("idle");
      return;
    }
    setPhase("done");
    timer.current = setTimeout(() => setPhase("idle"), successDurationMs);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={off}
      style={[
        styles.compactButton,
        phase === "done" ? styles.compactButtonDone : disabled ? styles.compactButtonDisabled : null,
      ]}
    >
      {phase === "busy" ? (
        <ActivityIndicator color={theme.accentInk} />
      ) : phase === "done" ? (
        <View style={styles.compactButtonRow}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={[styles.compactButtonText, { color: "#fff" }]}>{successLabel}</Text>
        </View>
      ) : (
        <Text style={styles.compactButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function DaysToggle({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <View style={styles.daysToggle}>
      {options.map((d) => (
        <Pressable key={d} onPress={() => onChange(d)} style={[styles.dayButton, value === d ? styles.dayButtonOn : null]}>
          <Text style={[styles.dayButtonText, value === d ? styles.dayButtonTextOn : null]}>{d}d</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MetricToggle({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 12 }}>
      {options.map((m) => (
        <Pressable key={m} onPress={() => onChange(m)} style={[styles.metricButton, value === m ? styles.metricButtonOn : null]}>
          <Text style={[styles.metricText, value === m ? styles.metricTextOn : null]}>{m}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChartPanel({
  title,
  subtitle,
  action,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <View style={styles.chartHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <CardTitle>{title}</CardTitle>
          {subtitle ? <Text style={styles.chartSub}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
      {loading ? <ActivityIndicator color={theme.accentStrong} style={{ marginVertical: 40 }} /> : children}
    </Card>
  );
}

type SeriesDef = {
  key: string;
  label: string;
  color: string;
  kind: "line" | "bar";
  axis?: "left" | "right";
};

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pathFromPoints(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function MultiSeriesChart({
  data,
  series,
  leftDomain,
  autoDomain,
  height = 230,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  leftDomain?: [number, number];
  autoDomain?: boolean;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const chartWidth = Math.max(1, width - 52);
  const plotH = height - 44;
  const left = 38;
  const top = 12;
  const values = data.flatMap((p) =>
    series.filter((s) => s.axis !== "right").map((s) => numericValue(p[s.key])).filter((v): v is number => v !== null)
  );
  const rightValues = data.flatMap((p) =>
    series.filter((s) => s.axis === "right").map((s) => numericValue(p[s.key])).filter((v): v is number => v !== null)
  );
  const min = autoDomain && values.length ? Math.min(...values) : leftDomain?.[0] ?? 0;
  const maxRaw = autoDomain && values.length ? Math.max(...values) : leftDomain?.[1] ?? 100;
  const pad = autoDomain ? Math.max(1, (maxRaw - min) * 0.18) : 0;
  const hasLeftBars = series.some((s) => s.kind === "bar" && s.axis !== "right");
  const yMin = autoDomain ? (hasLeftBars ? 0 : min >= 0 ? Math.max(0, min - pad) : min - pad) : min;
  const yMax = autoDomain ? maxRaw + pad : maxRaw;
  const rightMax = rightValues.length ? Math.max(...rightValues, 1) : 1;
  const x = (i: number) => left + (data.length <= 1 ? chartWidth / 2 : (i / (data.length - 1)) * chartWidth);
  const y = (v: number, axis?: "left" | "right") => {
    const max = axis === "right" ? rightMax : yMax;
    const minV = axis === "right" ? 0 : yMin;
    return top + plotH - ((v - minV) / Math.max(1, max - minV)) * plotH;
  };

  const paths = series.filter((s) => s.kind === "line").map((s) => {
    const segments: { x: number; y: number }[][] = [];
    const points: { v: number; i: number }[] = [];
    let current: { x: number; y: number }[] = [];

    data.forEach((p, i) => {
      const v = numericValue(p[s.key]);
      if (v === null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      points.push({ v, i });
      current.push({ x: x(i), y: y(v, s.axis) });
    });
    if (current.length) segments.push(current);
    return { ...s, segments, points };
  });
  const bars = series.filter((s) => s.kind === "bar");
  const barW = Math.max(3, Math.min(11, chartWidth / Math.max(1, data.length) * 0.55));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[0, 0.5, 1].map((t) => (
            <Line key={t} x1={left} x2={left + chartWidth} y1={top + plotH * t} y2={top + plotH * t} stroke={colors.lineStrong} strokeWidth={1} />
          ))}
          <Line x1={left} x2={left + chartWidth} y1={top + plotH} y2={top + plotH} stroke={colors.lineStrong} strokeWidth={1} />
          {[0, 0.5, 1].map((t) => (
            <SvgText key={t} x={2} y={top + plotH * t + 4} fill={colors.inkFaint} fontSize="10">
              {Math.round(yMax - (yMax - yMin) * t)}
            </SvgText>
          ))}
          {rightValues.length ? [0, 0.5, 1].map((t) => (
            <SvgText key={t} x={left + chartWidth + 6} y={top + plotH * t + 4} fill={colors.inkFaint} fontSize="10">
              {Math.round(rightMax - rightMax * t)}
            </SvgText>
          )) : null}
          {bars.map((s) => data.map((p, i) => {
            const v = numericValue(p[s.key]);
            if (v === null) return null;
            const yy = y(v, s.axis);
            return <Rect key={`${s.key}-${i}`} x={x(i) - barW / 2} y={yy} width={barW} height={top + plotH - yy} rx={3} fill={s.color} opacity={0.95} />;
          }))}
          {paths.map((p) => p.segments.map((segment, index) => (
            <Path key={`${p.key}-${index}`} d={pathFromPoints(segment)} stroke={p.color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )))}
          {paths.map((p) => p.points.map((point) => (
            <Circle key={`${p.key}-dot-${point.i}`} cx={x(point.i)} cy={y(point.v, p.axis)} r={2.5} fill={p.color} />
          )))}
          {data.length ? (
            <>
              <SvgText x={left} y={height - 8} fill={colors.inkFaint} fontSize="10">{shortDate(String(data[0].date ?? ""))}</SvgText>
              <SvgText x={left + chartWidth - 36} y={height - 8} fill={colors.inkFaint} fontSize="10">{shortDate(String(data[data.length - 1].date ?? ""))}</SvgText>
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 22 },
  stack: { gap: 14 },
  stackSmall: { gap: 10 },
  notice: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  noticeText: { fontSize: 13, fontWeight: "600" },
  checkInNudge: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: `${theme.accentStrong}33`,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkInIcon: {
    height: 34,
    width: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  checkInTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  checkInSub: { marginTop: 1, color: colors.inkMuted, fontSize: 11 },
  checkInButton: {
    height: 36,
    borderRadius: radius.md,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  checkInButtonText: { color: theme.accentInk, fontSize: 12, fontWeight: "800" },
  checkInClose: { height: 28, width: 24, alignItems: "center", justifyContent: "center" },
  warnStrip: {
    borderWidth: 1,
    borderColor: `${colors.warn}55`,
    backgroundColor: `${colors.warn}16`,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  warnText: { flex: 1, color: colors.warn, fontSize: 12 },
  heroCard: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 18,
    paddingVertical: 22,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 2,
  },
  heroText: { marginTop: 8, color: colors.inkMuted, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 300 },
  heroButton: {
    marginTop: 14,
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroButtonPrimary: { backgroundColor: "#ff7e1a" },
  heroButtonSecondary: {
    borderWidth: 1,
    borderColor: `${theme.accentStrong}33`,
    backgroundColor: `${theme.accent}1a`,
  },
  heroButtonText: { fontSize: 14, fontWeight: "800" },
  heroButtonPrimaryText: { color: theme.accentInk },
  heroButtonSecondaryText: { color: theme.accentStrong },
  bandLegendCard: { padding: 12 },
  bandLegendHeader: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 10 },
  bandLegendHeaderRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 7 },
  bandLegendDot: { height: 10, width: 10, borderRadius: 5 },
  bandLegendRows: { gap: 12, marginTop: 12 },
  bandLegendRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bandLegendRowDot: { height: 10, width: 10, borderRadius: 5, marginTop: 4 },
  bandLegendText: { flex: 1, minWidth: 0 },
  bandLegendLine: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  bandLegendLabel: { color: colors.ink, fontWeight: "800" },
  bandLegendRange: { color: colors.inkFaint, fontSize: 11 },
  bandLegendNote: { marginTop: 1, color: colors.inkMuted, fontSize: 11, lineHeight: 16 },
  statGrid: { flexDirection: "row", gap: 8 },
  statTile: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  tileLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tileLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1.5 },
  tileValue: { marginTop: 7, fontSize: 21, fontWeight: "800", color: colors.ink },
  tileSub: { marginTop: 4, color: colors.inkMuted, fontSize: 11 },
  cardTitle: { color: colors.inkMuted, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 2 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  slotPill: { flexGrow: 1, flexBasis: 104, minWidth: 104, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  slotPillDone: { borderColor: `${colors.ok}66`, backgroundColor: `${colors.ok}10` },
  slotType: { marginTop: 6, color: colors.ink, fontSize: 16, fontWeight: "800" },
  hydrationHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12 },
  hydrationTotal: { color: colors.ink, fontSize: 30, fontWeight: "800" },
  hydrationUnit: { color: colors.inkFaint, fontSize: 14, fontWeight: "700" },
  hydrationPct: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  progressTrack: { marginTop: 10, height: 10, borderRadius: 999, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999 },
  quickWaterGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  secondaryButton: { flex: 1, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: `${theme.accentStrong}44`, backgroundColor: `${theme.accent}1a`, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: theme.accentStrong, fontSize: 12, fontWeight: "800" },
  waterEntryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  waterEntryChip: {
    minHeight: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  waterEntryText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  miniMuted: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  loadRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  loadValue: { color: colors.ink, fontSize: 28, fontWeight: "800" },
  loadMeta: { flex: 1, color: colors.inkFaint, fontSize: 11 },
  riskReasonList: { gap: 2, marginTop: 7 },
  riskReasonText: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { textTransform: "uppercase", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  chartHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  chartSub: { marginTop: 5, color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  daysToggle: { flexDirection: "row", gap: 5 },
  dayButton: { height: 34, minWidth: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised },
  dayButtonOn: { backgroundColor: "#ff7e1a", borderColor: "#ff7e1a" },
  dayButtonText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  dayButtonTextOn: { color: "#1a0c00" },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.inkMuted, fontWeight: "600" },
  // Trends — sub-tab switcher
  trendTabs: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  trendTab: { height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, justifyContent: "center", backgroundColor: colors.surfaceRaised },
  trendTabOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  trendTabText: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  trendTabTextOn: { color: "#1a0c00" },
  // Trends — summary tiles
  tileRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  trendTile: { flex: 1, minWidth: 0, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 8 },
  trendTileLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  trendTileValue: { marginTop: 2, fontSize: 20, fontWeight: "800", color: colors.ink },
  trendTileUnit: { fontSize: 11, fontWeight: "700", color: colors.inkFaint },
  // Trend verdict badge
  badge: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
  badgeNoData: { fontSize: 10, fontWeight: "700", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.5 },
  // "At a glance" / "How to read this" footers
  insightBox: { marginTop: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  insightKicker: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  insightBody: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  insightStats: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  insightStat: { fontSize: 11, color: colors.inkMuted },
  insightStatVal: { fontWeight: "800", color: colors.ink },
  aboutBox: { marginTop: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  aboutBody: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  // Wellness signal rows
  wellnessRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  wellnessRowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  wellnessLabelCol: { width: 80, flexShrink: 0 },
  wellnessLabel: { fontSize: 12, fontWeight: "700", color: colors.ink },
  wellnessHint: { fontSize: 9, color: colors.inkFaint },
  wellnessSpark: { flex: 1, minWidth: 0 },
  wellnessValue: { width: 42, textAlign: "right", fontSize: 15, fontWeight: "800", color: colors.ink },
  wellnessUnit: { fontSize: 9, fontWeight: "600", color: colors.inkFaint },
  wellnessBadge: { width: 84, alignItems: "flex-end" },
  latestRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  perfLatest: { color: colors.ink, fontSize: 30, fontWeight: "800" },
  perfUnit: { color: colors.inkFaint, fontSize: 14 },
  metricButton: { height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, justifyContent: "center", backgroundColor: colors.surfaceRaised },
  metricButtonOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  metricText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  metricTextOn: { color: "#1a0c00" },
  inputLabel: { marginBottom: 7, color: colors.inkFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  compactField: { height: 38, borderRadius: radius.sm, fontSize: 13, paddingHorizontal: 12 },
  scaleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  scaleLabel: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  scaleValue: { color: theme.accentStrong, fontSize: 11, fontWeight: "800" },
  scaleTrack: {
    height: 16,
    justifyContent: "center",
    overflow: "visible",
  },
  scaleBase: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.lineStrong,
  },
  scaleFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 999,
    backgroundColor: theme.accentStrong,
  },
  scaleThumb: {
    position: "absolute",
    marginLeft: -6,
    height: 12,
    width: 12,
    borderRadius: 6,
    backgroundColor: theme.accentStrong,
  },
  scaleHints: { flexDirection: "row", justifyContent: "space-between" },
  scaleHint: { color: colors.inkFaint, fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  choiceGrid: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, minHeight: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  choiceOn: { backgroundColor: "#ff7e1a", borderColor: "#ff7e1a" },
  choiceText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  choiceTextOn: { color: "#1a0c00" },
  compactButton: {
    marginTop: 4,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  compactButtonDisabled: { opacity: 0.45 },
  compactButtonDone: { backgroundColor: colors.ok },
  compactButtonRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  compactButtonText: { color: theme.accentInk, fontSize: 12, fontWeight: "800" },
  // Log checklist hub
  logHub: { padding: 0, overflow: "hidden" },
  logHubHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  logProgressLine: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  logProgressTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  logProgressFill: { height: 8, borderRadius: 999, backgroundColor: theme.accentStrong },
  logProgressPill: { borderRadius: 999, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 4 },
  logProgressPillDone: { backgroundColor: `${colors.ok}1e` },
  logProgressText: { fontSize: 11, fontWeight: "800", color: colors.inkMuted, letterSpacing: 0.3 },
  logProgressTextDone: { color: colors.ok },
  restDayPanel: { marginHorizontal: 16, marginVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  restDayTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  restDayText: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  restToggle: { height: 36, width: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  restToggleOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentStrong },
  sessionTabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  sessionTab: {
    flex: 1,
    minHeight: 82,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "space-between",
  },
  sessionTabActive: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  sessionTabDone: { borderColor: `${colors.ok}55` },
  sessionTabLabel: { color: colors.inkFaint, fontSize: 10, fontWeight: "900", letterSpacing: 1.3, textTransform: "uppercase" },
  sessionTabLabelActive: { color: theme.accentStrong },
  sessionTabTitle: { marginTop: 6, color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 17 },
  sessionTabMeta: { marginTop: 4, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  sessionFormPanel: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
  },
  sessionFormTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  logRowWrap: { borderTopWidth: 1, borderTopColor: colors.line },
  logRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  logRowTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "700", color: colors.ink },
  logRowStatus: { fontSize: 12, fontWeight: "600", color: colors.inkFaint, maxWidth: 132, textAlign: "right" },
  logRowStatusDone: { color: colors.inkMuted },
  logRowBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2 },
  sessionMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  formError: { marginTop: 8, color: colors.bad, fontSize: 12, fontWeight: "700" },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  estLoad: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  trainingChip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 9 },
  trainingChipOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  trainingText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  trainingTextOn: { color: theme.accentStrong },
  twoCols: { flexDirection: "row", gap: 12 },
  recoveryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  recoveryChip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 9 },
  recoveryChipOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  recoveryText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  recoveryTextOn: { color: theme.accentStrong },
  noteBox: { minHeight: 92, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 14, textAlignVertical: "top" },
  noteItem: { borderLeftWidth: 3, borderLeftColor: theme.accentStrong, backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 10 },
  noteText: { color: colors.ink, fontSize: 13 },
  accentItem: { borderLeftWidth: 3, borderLeftColor: theme.accentStrong, backgroundColor: `${theme.accent}0f`, borderRadius: radius.md, padding: 10 },
  insetItem: { borderLeftWidth: 3, borderLeftColor: colors.inkFaint, backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 10 },
  itemBody: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  itemMeta: { marginTop: 5, color: colors.inkFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  timeline: { position: "relative", gap: 12, paddingLeft: 17, marginTop: 12 },
  timelineLine: { position: "absolute", left: 4, top: 7, bottom: 4, width: 1, backgroundColor: colors.line },
  timelineItem: { position: "relative", flexDirection: "row", gap: 10 },
  timelineDot: {
    position: "absolute",
    left: -17,
    top: 4,
    height: 10,
    width: 10,
    borderRadius: 5,
    shadowOpacity: 0.4,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  timelineTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  timelineTitle: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  timelineTime: { color: colors.inkFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  timelineDetail: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  directChat: { flex: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, backgroundColor: colors.surface },
  directTopRow: { minHeight: 42, justifyContent: "center", alignItems: "flex-start" },
  directBack: {
    height: 38,
    width: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  directThread: { flex: 1, justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 70 },
  emptyText: { color: colors.inkMuted, fontSize: 14, textAlign: "center" },
  emptySub: { marginTop: 7, color: colors.inkFaint, fontSize: 11, textAlign: "center" },
  directError: { color: colors.bad, fontSize: 12, marginBottom: 8 },
  directMessageList: { flexGrow: 1, justifyContent: "flex-end", gap: 6, paddingVertical: 10 },
  dayMarker: {
    alignSelf: "center",
    color: colors.inkFaint,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginVertical: 8,
  },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowMine: { justifyContent: "flex-end" },
  messageBubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  messageBubbleMine: { backgroundColor: theme.accentStrong },
  messageBubbleOther: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  messageBody: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  messageBodyMine: { color: theme.accentInk },
  messageTime: { marginTop: 3, color: colors.inkFaint, fontSize: 10, textAlign: "right", fontWeight: "700" },
  messageTimeMine: { color: "rgba(255,255,255,0.72)" },
  directComposer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  directInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${theme.accentStrong}55`,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.ink,
    fontSize: 14,
    textAlignVertical: "top",
  },
  directSend: {
    height: 44,
    width: 44,
    borderRadius: radius.md,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  directSendOff: { backgroundColor: `${theme.accentStrong}33` },
  threadPickerList: { gap: 10, paddingVertical: 10 },
  threadPickerItem: {
    minHeight: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  threadPickerItemOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  threadAvatar: { height: 42, width: 42, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  threadAvatarOn: { backgroundColor: theme.accentStrong },
  threadAvatarText: { color: colors.inkMuted, fontSize: 16, fontWeight: "900" },
  threadAvatarTextOn: { color: theme.accentInk },
  threadName: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  threadMeta: { marginTop: 2, color: colors.inkMuted, fontSize: 12 },
  threadUnread: { height: 9, width: 9, borderRadius: 5, backgroundColor: colors.bad },
});
