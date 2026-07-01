import { useCallback, useEffect, useMemo, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { apiFetch, apiJson } from "../../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../../lib/theme";
import { Banner, Card, Muted, PrimaryButton } from "../../../components/ui";
import { Ring } from "../../../components/Ring";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { DatePickerPill } from "../../../components/DatePickerPill";
import { column, fmtMagnitude, latestVal, summarizeTrend } from "../../../lib/trendStats";

type SessionSlot = "AM" | "AFT" | "PM";

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  date: string;
  attendance: { status: string | null; note?: string | null };
  sessions: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  heartRate: { wakeHr: number | null; bedHr: number | null };
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

type TrendPoint = {
  date: string;
  readiness: number | null;
  load: number | null;
  sleepHours: number | null;
  recoveryScore: number | null;
};

type WellnessPoint = {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  fatigue: number | null;
  wakeHr: number | null;
  bedHr: number | null;
  waterPct: number | null;
};

type RpeEntry = NonNullable<DailyCard["rpe"]> & { _id: string };
type PerfEntry = { _id: string; date: string; metric: string; value: number; unit: string; context?: string | null };
type ActivityItem = {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  band?: "green" | "amber" | "red";
};

type Tab = "overview" | "training" | "rpe" | "performance" | "activity";
type ChartTab = "readiness" | "hr" | "wellness" | "performance";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "training", label: "Training" },
  { key: "rpe", label: "RPE" },
  { key: "performance", label: "Performance" },
  { key: "activity", label: "Activity" },
];

const CHART_TABS: { key: ChartTab; label: string }[] = [
  { key: "readiness", label: "Readiness" },
  { key: "hr", label: "Heart rate" },
  { key: "wellness", label: "Wellness" },
  { key: "performance", label: "Performance" },
];

const SESSION_SLOTS: SessionSlot[] = ["AM", "AFT", "PM"];
const SLOT_LABEL: Record<SessionSlot, string> = { AM: "AM", AFT: "Afternoon", PM: "PM" };
const today = () => new Date().toISOString().slice(0, 10);
const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v).replace("_", " "));

function cleanParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function shortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function riskColor(risk: "green" | "amber" | "red"): string {
  if (risk === "green") return colors.ok;
  if (risk === "amber") return colors.warn;
  return colors.bad;
}

function lowerIsBetterMetric(metric: string): boolean {
  return /sprint|dash|time|hr|heart|stress|soreness|fatigue/i.test(metric);
}

export default function AthleteDetail() {
  const accent = ROLE_THEMES.coach.accent;
  const router = useRouter();
  const params = useLocalSearchParams<{ athleteId?: string | string[]; name?: string | string[] }>();
  const athleteId = cleanParam(params.athleteId);
  const nameParam = cleanParam(params.name);
  const [date, setDate] = useState(() => today());
  const [tab, setTab] = useState<Tab>("overview");
  const [chartTab, setChartTab] = useState<ChartTab>("readiness");
  const [card, setCard] = useState<DailyCard | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [wellness, setWellness] = useState<WellnessPoint[]>([]);
  const [rpeEntries, setRpeEntries] = useState<RpeEntry[]>([]);
  const [perfEntries, setPerfEntries] = useState<PerfEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentMsg, setCommentMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    setError(null);
    try {
      const [cardResult, trendsResult, wellnessResult, rpeResult, perfResult, activityResult] =
        await Promise.allSettled([
          apiJson<{ card: DailyCard }>(`/api/coach/athletes/${athleteId}/daily-card?date=${date}`),
          apiJson<{ series: TrendPoint[] }>(`/api/coach/athletes/${athleteId}/trends?days=30`),
          apiJson<{ series: WellnessPoint[] }>(`/api/coach/athletes/${athleteId}/analytics/wellness?days=30`),
          apiJson<{ entries: RpeEntry[] }>(`/api/coach/athletes/${athleteId}/rpe-monitoring?date=${date}`),
          apiJson<{ entries: PerfEntry[] }>(`/api/coach/athletes/${athleteId}/performance?limit=50`),
          apiJson<{ items: ActivityItem[] }>(`/api/coach/athletes/${athleteId}/activity?limit=40`),
        ]);
      if (cardResult.status !== "fulfilled") throw new Error("daily_card_failed");
      setCard(cardResult.value.card);
      setTrends(trendsResult.status === "fulfilled" ? trendsResult.value.series ?? [] : []);
      setWellness(wellnessResult.status === "fulfilled" ? wellnessResult.value.series ?? [] : []);
      setRpeEntries(rpeResult.status === "fulfilled" ? rpeResult.value.entries ?? [] : []);
      setPerfEntries(perfResult.status === "fulfilled" ? perfResult.value.entries ?? [] : []);
      setActivity(activityResult.status === "fulfilled" ? activityResult.value.items ?? [] : []);
    } catch {
      setError("Couldn't load this athlete. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, [athleteId, date]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendComment() {
    setCommentMsg(null);
    const body = comment.trim();
    if (!body || !athleteId) return false;
    setPosting(true);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/comment`, {
        method: "POST",
        body: JSON.stringify({ body, date }),
      });
      if (!res.ok) throw new Error("comment_failed");
      setComment("");
      setCommentMsg({ kind: "ok", text: "Feedback sent." });
      return true;
    } catch {
      setCommentMsg({ kind: "error", text: "Couldn't send. Try again." });
      return false;
    } finally {
      setPosting(false);
    }
  }

  const title = card?.name || nameParam || "Athlete";
  const subtitle = [card?.sport, card?.position].filter(Boolean).join(" - ");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <ScreenHeader
          title={title}
          accent={accent}
          roleLabel="Coach"
          subtitle={subtitle || undefined}
          inlineActions
          headerActions={<DatePickerPill value={date} onChange={setDate} accent={accent} accentInk="#fff" compact />}
        />

        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
          <Ionicons name="arrow-back" size={15} color={colors.inkMuted} />
          <Text style={styles.backText}>Back to roster</Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {TABS.map((item) => {
            const active = item.key === tab;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setTab(item.key);
                  setCommentMsg(null);
                }}
                style={[styles.tabChip, active ? { backgroundColor: accent, borderColor: accent } : null]}
              >
                <Text style={[styles.tabText, active ? { color: "#fff" } : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {error ? <Banner kind="error">{error}</Banner> : null}

        {loading && !card ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : !card ? (
          <Card>
            <Muted>No data for this athlete.</Muted>
          </Card>
        ) : (
          <>
            {tab === "overview" ? (
              <OverviewTab
                card={card}
                trends={trends}
                wellness={wellness}
                perfEntries={perfEntries}
                chartTab={chartTab}
                setChartTab={setChartTab}
              />
            ) : tab === "training" ? (
              <TrainingTab card={card} />
            ) : tab === "rpe" ? (
              <RpeTab entries={rpeEntries} />
            ) : tab === "performance" ? (
              <PerformanceTab entries={perfEntries} />
            ) : (
              <ActivityTab items={activity} />
            )}

            <Card style={styles.feedbackCard}>
              <Text style={styles.cardTitle}>Send feedback</Text>
              <TextInput
                value={comment}
                onChangeText={(value) => {
                  setComment(value);
                  if (commentMsg) setCommentMsg(null);
                }}
                placeholder="Recommend an adjustment for this athlete..."
                placeholderTextColor={colors.inkFaint}
                multiline
                maxLength={1000}
                editable={!posting}
                style={styles.composer}
              />
              {commentMsg ? <Banner kind={commentMsg.kind}>{commentMsg.text}</Banner> : null}
              <PrimaryButton
                label="Send feedback"
                onPress={sendComment}
                loading={posting}
                disabled={!comment.trim()}
                successLabel="Sent"
                accent="#9bcfbe"
                accentInk="#fff"
              />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function OverviewTab({
  card,
  trends,
  wellness,
  perfEntries,
  chartTab,
  setChartTab,
}: {
  card: DailyCard;
  trends: TrendPoint[];
  wellness: WellnessPoint[];
  perfEntries: PerfEntry[];
  chartTab: ChartTab;
  setChartTab: (tab: ChartTab) => void;
}) {
  return (
    <View style={styles.stack}>
      <Card style={styles.overviewCard}>
        <View style={styles.overviewTop}>
          <Ring score={card.readinessScore} size={106} stroke={9} label="Readiness" />
          <View style={styles.overviewSide}>
            <Text style={styles.athleteMeta} numberOfLines={1}>
              {[card.sport, card.position].filter(Boolean).join(" - ") || "-"}
            </Text>
            <InfoTile
              icon="moon-outline"
              label="Sleep"
              value={dash(card.sleep.hours)}
              sub={`quality ${dash(card.sleep.quality)}/5`}
            />
            <InfoTile
              icon="pulse-outline"
              label="Recovery"
              value={dash(card.recovery.score)}
              sub={card.recovery.status ?? "no data"}
            />
          </View>
        </View>

        <Text style={styles.inlineMeta}>
          Attendance <Text style={styles.inlineStrong}>{dash(card.attendance?.status)}</Text>
        </Text>
        <View style={styles.sessionGrid}>
          {SESSION_SLOTS.map((slot) => (
            <InfoTile
              key={slot}
              label={SLOT_LABEL[slot]}
              value={dash(card.sessions[slot]?.status)}
              sub={card.sessions[slot]?.type ?? undefined}
            />
          ))}
        </View>

        {card.injury.active ? (
          <View style={styles.injuryBanner}>
            <Ionicons name="shield-outline" size={15} color={colors.warn} />
            <Text style={styles.injuryText}>
              {[card.injury.bodyPart, card.injury.severity, card.injury.restriction].filter(Boolean).join(" - ")}
            </Text>
          </View>
        ) : null}
      </Card>

      <TrainingLoadCard card={card} />

      <Card style={styles.chartCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartTabRow}>
          {CHART_TABS.map((item) => {
            const active = item.key === chartTab;
            return (
              <Pressable
                key={item.key}
                onPress={() => setChartTab(item.key)}
                style={[styles.chartChip, active ? { backgroundColor: ROLE_THEMES.coach.accent, borderColor: ROLE_THEMES.coach.accent } : null]}
              >
                <Text style={[styles.chartChipText, active ? { color: "#fff" } : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {chartTab === "readiness" ? (
          <ReadinessPanel trends={trends} />
        ) : chartTab === "hr" ? (
          <HeartRatePanel wellness={wellness} />
        ) : chartTab === "wellness" ? (
          <WellnessPanel wellness={wellness} />
        ) : (
          <PerformancePanel entries={perfEntries} />
        )}
      </Card>
    </View>
  );
}

function TrainingLoadCard({ card }: { card: DailyCard }) {
  return (
    <Card style={styles.loadCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.cardTitle}>Training load</Text>
        <Ionicons name="flame-outline" size={15} color={colors.inkMuted} />
      </View>
      {card.rpe ? (
        <>
          <View style={styles.loadTop}>
            <Pill label={card.rpe.riskFlag} color={riskColor(card.rpe.riskFlag)} />
            <Text style={styles.loadNumber}>{card.rpe.calculatedTrainingLoad}</Text>
            <Text style={styles.loadMeta}>
              RPE {card.rpe.rpe} - {SLOT_LABEL[card.rpe.sessionType]}
            </Text>
          </View>
          <Text style={styles.loadDetail}>
            {card.rpe.trainingCategory} - {card.rpe.plannedIntensityPercent}% intensity
          </Text>
          {card.rpe.riskReasons && card.rpe.riskReasons.length > 0 ? (
            <View style={styles.reasonList}>
              {card.rpe.riskReasons.slice(0, 3).map((reason, index) => (
                <Text key={`${reason}-${index}`} style={styles.reasonText}>
                  - {reason}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.emptyText}>No RPE logged for this date.</Text>
      )}
    </Card>
  );
}

function ReadinessPanel({ trends }: { trends: TrendPoint[] }) {
  const readiness = column(trends, "readiness");
  const recovery = column(trends, "recoveryScore");
  const load = column(trends, "load");
  const maxLoad = Math.max(1, ...load.filter((v): v is number => v !== null));
  const data = trends.map((point) => ({
    date: point.date,
    readiness: point.readiness,
    recovery: point.recoveryScore,
    load: point.load,
  }));
  return (
    <View style={styles.panelStack}>
      <View style={styles.metricGrid}>
        <TrendMetric label="Readiness" value={formatLatest(readiness)} color="#6bbd2a" values={readiness} />
        <TrendMetric label="Recovery" value={formatLatest(recovery)} color="#2f7df6" values={recovery} />
        <TrendMetric label="Load" value={formatLatest(load)} color="#f47c20" values={load} neutral />
      </View>
      <MiniSeriesChart
        data={data}
        series={[
          { key: "load", label: "Load", color: "#f47c20", kind: "bar", max: maxLoad },
          { key: "readiness", label: "Readiness", color: "#6bbd2a", kind: "line", max: 100 },
          { key: "recovery", label: "Recovery", color: "#2f7df6", kind: "line", max: 100 },
        ]}
      />
      <ChartInsight label="Readiness" values={readiness} />
      <ChartAbout>
        Green is daily readiness, blue is recovery, and orange bars are training load. Orange bars are scaled on their own range so load spikes are easy to spot.
      </ChartAbout>
    </View>
  );
}

function HeartRatePanel({ wellness }: { wellness: WellnessPoint[] }) {
  const wake = column(wellness, "wakeHr");
  const bed = column(wellness, "bedHr");
  const values = [...wake, ...bed].filter((v): v is number => v !== null);
  const max = Math.max(80, ...values);
  return (
    <View style={styles.panelStack}>
      <View style={styles.metricGrid}>
        <TrendMetric label="Waking HR" value={formatLatest(wake, " bpm")} color="#2f7df6" values={wake} lowerIsBetter unit="bpm" />
        <TrendMetric label="Before bed" value={formatLatest(bed, " bpm")} color="#e8892b" values={bed} neutral unit="bpm" />
      </View>
      <MiniSeriesChart
        data={wellness.map((point) => ({ date: point.date, wake: point.wakeHr, bed: point.bedHr }))}
        series={[
          { key: "wake", label: "Waking HR", color: "#2f7df6", kind: "line", max },
          { key: "bed", label: "Before bed", color: "#e8892b", kind: "line", max },
        ]}
      />
      <ChartInsight label="Waking HR" values={wake} unit="bpm" lowerIsBetter />
      <ChartAbout>Lower waking heart rate usually points to better recovery; compare it with before-bed heart rate to see daily strain.</ChartAbout>
    </View>
  );
}

function WellnessPanel({ wellness }: { wellness: WellnessPoint[] }) {
  const rows = [
    { label: "Sleep quality", key: "sleepQuality" as const, lowerIsBetter: false, suffix: "/5" },
    { label: "Mood", key: "mood" as const, lowerIsBetter: false, suffix: "/5" },
    { label: "Stress", key: "stress" as const, lowerIsBetter: true, suffix: "/5" },
    { label: "Soreness", key: "soreness" as const, lowerIsBetter: true, suffix: "/5" },
    { label: "Fatigue", key: "fatigue" as const, lowerIsBetter: true, suffix: "/5" },
    { label: "Hydration", key: "waterPct" as const, lowerIsBetter: false, suffix: "%" },
  ];
  return (
    <View style={styles.panelStack}>
      {rows.map((row) => {
        const values = column(wellness, row.key);
        return (
          <View key={row.key} style={styles.wellnessRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.wellnessLabel}>{row.label}</Text>
              <Text style={styles.wellnessSub}>{row.lowerIsBetter ? "Lower is better" : "Higher is better"}</Text>
            </View>
            <Text style={styles.wellnessValue}>{formatLatest(values, row.suffix)}</Text>
            <TrendBadge values={values} lowerIsBetter={row.lowerIsBetter} showMagnitude={false} />
          </View>
        );
      })}
      <ChartAbout>Use these signals as context for readiness, not as a single pass/fail score.</ChartAbout>
    </View>
  );
}

function PerformancePanel({ entries }: { entries: PerfEntry[] }) {
  const ordered = useMemo(() => [...entries].reverse(), [entries]);
  const latest = entries[0];
  const values = ordered.map((entry) => entry.value);
  const unit = latest?.unit ? ` ${latest.unit}` : "";
  const max = Math.max(1, ...values);
  return (
    <View style={styles.panelStack}>
      {entries.length === 0 ? (
        <Text style={styles.emptyText}>No performance results yet.</Text>
      ) : (
        <>
          <View style={styles.metricGrid}>
            <TrendMetric
              label={latest?.metric ?? "Metric"}
              value={latest ? `${latest.value}${unit}` : "-"}
              color={ROLE_THEMES.coach.accent}
              values={values}
              lowerIsBetter={latest ? lowerIsBetterMetric(latest.metric) : false}
              unit={unit.trim()}
            />
          </View>
          <MiniSeriesChart
            data={ordered.map((entry) => ({ date: entry.date, value: entry.value }))}
            series={[{ key: "value", label: latest?.metric ?? "Result", color: ROLE_THEMES.coach.accent, kind: "line", max }]}
          />
          <ChartInsight
            label={latest?.metric ?? "Performance"}
            values={values}
            unit={unit.trim()}
            lowerIsBetter={latest ? lowerIsBetterMetric(latest.metric) : false}
          />
        </>
      )}
    </View>
  );
}

function TrainingTab({ card }: { card: DailyCard }) {
  return (
    <View style={styles.stack}>
      <Card style={styles.loadCard}>
        <Text style={styles.cardTitle}>Attendance</Text>
        <View style={styles.optionRow}>
          {["present", "late", "absent", "excused"].map((status) => (
            <View key={status} style={[styles.optionPill, card.attendance.status === status ? styles.optionActive : null]}>
              <Text style={[styles.optionText, card.attendance.status === status ? styles.optionTextActive : null]}>
                {status}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      {SESSION_SLOTS.map((slot) => (
        <Card key={slot} style={styles.loadCard}>
          <Text style={styles.cardTitle}>{SLOT_LABEL[slot]} session</Text>
          <View style={styles.sessionLine}>
            <Text style={styles.sessionStatus}>{dash(card.sessions[slot]?.status)}</Text>
            <Text style={styles.sessionType}>{card.sessions[slot]?.type ?? "Rest / unset"}</Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

function RpeTab({ entries }: { entries: RpeEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card>
        <Text style={styles.emptyText}>No RPE entries for this date.</Text>
      </Card>
    );
  }
  return (
    <View style={styles.stack}>
      {entries.map((entry) => (
        <Card key={entry._id} style={styles.loadCard}>
          <Text style={styles.cardTitle}>
            {SLOT_LABEL[entry.sessionType]} - {entry.trainingCategory}
          </Text>
          <View style={styles.loadTop}>
            <Pill label={entry.riskFlag} color={riskColor(entry.riskFlag)} />
            <Text style={styles.loadNumber}>{entry.calculatedTrainingLoad}</Text>
            <Text style={styles.loadMeta}>
              RPE {entry.rpe} - {entry.plannedIntensityPercent}%
            </Text>
          </View>
          <View style={styles.rpeGrid}>
            <InfoTile label="Sleep" value={`${entry.sleepQuality}/5`} />
            <InfoTile label="Soreness" value={`${entry.muscleSoreness}/5`} />
            <InfoTile label="Fatigue" value={`${entry.fatigue}/5`} />
            <InfoTile label="Mood" value={`${entry.moodMotivation}/5`} />
          </View>
          {entry.bodyConditionFeedback ? <Text style={styles.noteBox}>{entry.bodyConditionFeedback}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

function PerformanceTab({ entries }: { entries: PerfEntry[] }) {
  return (
    <Card style={styles.loadCard}>
      <Text style={styles.cardTitle}>History - {entries.length}</Text>
      {entries.length === 0 ? (
        <Text style={styles.emptyText}>No performance results yet.</Text>
      ) : (
        <View style={styles.historyList}>
          {entries.slice(0, 12).map((entry) => (
            <View key={entry._id} style={styles.historyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.historyTitle} numberOfLines={1}>{entry.metric}</Text>
                <Text style={styles.historyMeta} numberOfLines={1}>
                  {entry.date.slice(0, 10)}
                  {entry.context ? ` - ${entry.context}` : ""}
                </Text>
              </View>
              <Text style={styles.historyValue}>
                {entry.value}
                <Text style={styles.historyUnit}> {entry.unit}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function ActivityTab({ items }: { items: ActivityItem[] }) {
  return (
    <Card style={styles.loadCard}>
      <Text style={styles.cardTitle}>Recent activity</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>No recent activity yet.</Text>
      ) : (
        <View style={styles.activityList}>
          {items.slice(0, 16).map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={[styles.activityDot, { backgroundColor: item.band ? riskColor(item.band) : colors.inkFaint }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.activityTitle} numberOfLines={1}>{item.title}</Text>
                {item.detail ? <Text style={styles.activityDetail} numberOfLines={2}>{item.detail}</Text> : null}
              </View>
              <Text style={styles.activityDate}>{shortDate(item.at)}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function InfoTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.infoTile}>
      <View style={styles.infoLabelRow}>
        {icon ? <Ionicons name={icon} size={12} color={colors.inkFaint} /> : null}
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.infoSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

function TrendMetric({
  label,
  value,
  color,
  values,
  lowerIsBetter,
  neutral,
  unit,
}: {
  label: string;
  value: string;
  color: string;
  values: (number | null)[];
  lowerIsBetter?: boolean;
  neutral?: boolean;
  unit?: string;
}) {
  return (
    <View style={styles.trendMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <TrendBadge values={values} lowerIsBetter={lowerIsBetter} neutral={neutral} unit={unit} />
    </View>
  );
}

function TrendBadge({
  values,
  lowerIsBetter,
  neutral,
  unit,
  showMagnitude = true,
}: {
  values: (number | null)[];
  lowerIsBetter?: boolean;
  neutral?: boolean;
  unit?: string;
  showMagnitude?: boolean;
}) {
  const summary = summarizeTrend(values, { lowerIsBetter });
  if (!summary) return <Text style={styles.noTrend}>No trend</Text>;
  const tone = summary.dir === "improving" ? colors.ok : summary.dir === "declining" ? colors.bad : colors.inkFaint;
  const label =
    summary.dir === "steady"
      ? "Steady"
      : neutral
      ? summary.rose
        ? "Rose"
        : "Fell"
      : summary.dir === "improving"
      ? "Improving"
      : "Declining";
  return (
    <View style={[styles.trendBadge, { backgroundColor: tone + "18" }]}>
      <Text style={[styles.trendBadgeText, { color: tone }]}>
        {label}
        {showMagnitude ? ` ${fmtMagnitude(summary, unit)}` : ""}
      </Text>
    </View>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color + "18" }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

type ChartRow = { date: string } & Record<string, number | string | null>;
type ChartSeries = { key: string; label: string; color: string; kind: "line" | "bar"; max?: number };

function MiniSeriesChart({ data, series }: { data: ChartRow[]; series: ChartSeries[] }) {
  const width = 320;
  const height = 170;
  const left = 28;
  const right = 16;
  const top = 12;
  const bottom = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const numericValues = data.flatMap((point) =>
    series.flatMap((s) => {
      const v = point[s.key];
      return typeof v === "number" ? [v] : [];
    })
  );
  if (data.length === 0 || numericValues.length === 0) {
    return (
      <View style={styles.emptyChart}>
        <Text style={styles.emptyText}>No trend data yet.</Text>
      </View>
    );
  }
  const step = plotW / Math.max(1, data.length - 1);
  const barStep = plotW / Math.max(1, data.length);
  const barWidth = Math.max(3, Math.min(8, barStep * 0.4));

  const yFor = (value: number, max: number) => top + plotH - (Math.max(0, value) / Math.max(1, max)) * plotH;
  const xFor = (index: number) => left + index * step;

  function pathsFor(s: ChartSeries): string[] {
    const paths: string[] = [];
    let current = "";
    data.forEach((point, index) => {
      const v = point[s.key];
      if (typeof v !== "number") {
        if (current) paths.push(current);
        current = "";
        return;
      }
      const cmd = current ? "L" : "M";
      current += `${cmd}${xFor(index).toFixed(1)} ${yFor(v, s.max ?? Math.max(1, ...numericValues)).toFixed(1)} `;
    });
    if (current) paths.push(current);
    return paths;
  }

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.5, 1].map((tick) => {
          const y = top + plotH * tick;
          const label = Math.round((1 - tick) * 100);
          return (
            <G key={tick}>
              <Line x1={left} x2={left + plotW} y1={y} y2={y} stroke={colors.lineStrong} strokeWidth={1} />
              <SvgText x={2} y={y + 4} fill={colors.inkFaint} fontSize="10">
                {label}
              </SvgText>
            </G>
          );
        })}
        {series.map((s) =>
          s.kind === "bar"
            ? data.map((point, index) => {
                const v = point[s.key];
                if (typeof v !== "number") return null;
                const y = yFor(v, s.max ?? Math.max(1, ...numericValues));
                return (
                  <Rect
                    key={`${s.key}-${point.date}`}
                    x={left + index * barStep + barStep * 0.3}
                    y={y}
                    width={barWidth}
                    height={top + plotH - y}
                    rx={3}
                    fill={s.color}
                    opacity={0.82}
                  />
                );
              })
            : pathsFor(s).map((path, index) => (
                <Path key={`${s.key}-${index}`} d={path} fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              ))
        )}
        <SvgText x={left} y={height - 8} fill={colors.inkFaint} fontSize="10">
          {shortDate(String(data[0]?.date ?? ""))}
        </SvgText>
        <SvgText x={left + plotW - 40} y={height - 8} fill={colors.inkFaint} fontSize="10">
          {shortDate(String(data[data.length - 1]?.date ?? ""))}
        </SvgText>
      </Svg>
      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ChartInsight({
  label,
  values,
  unit,
  lowerIsBetter,
}: {
  label: string;
  values: (number | null)[];
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  const avg = Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  const best = lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const summary = summarizeTrend(values, { lowerIsBetter });
  const verdict = summary?.dir === "improving" ? "Improving" : summary?.dir === "declining" ? "Declining" : "Steady";
  return (
    <View style={styles.insightBox}>
      <Text style={styles.insightTitle}>At a glance - {label}</Text>
      <Text style={styles.insightBody}>
        {verdict} across this window. Avg {avg}
        {unit ? ` ${unit}` : ""} - Best {best}
        {unit ? ` ${unit}` : ""} - Range {min}-{max}
        {unit ? ` ${unit}` : ""}
      </Text>
    </View>
  );
}

function ChartAbout({ children }: { children: string }) {
  return (
    <View style={styles.aboutBox}>
      <Text style={styles.insightTitle}>How to read this</Text>
      <Text style={styles.insightBody}>{children}</Text>
    </View>
  );
}

function formatLatest(values: (number | null)[], suffix = ""): string {
  const latest = latestVal(values);
  return latest === null ? "-" : `${Math.round(latest)}${suffix}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 26 },
  backButton: {
    alignSelf: "flex-start",
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  backText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  tabRow: { gap: 8, paddingRight: 2, marginBottom: 14 },
  tabChip: {
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: { color: colors.inkMuted, fontSize: 11, fontWeight: "900" },
  stack: { gap: 12 },
  overviewCard: { gap: 12 },
  overviewTop: { flexDirection: "row", gap: 14, alignItems: "center" },
  overviewSide: { flex: 1, minWidth: 0, gap: 8 },
  athleteMeta: { color: colors.ink, fontSize: 14, fontWeight: "800", textTransform: "capitalize" },
  inlineMeta: { color: colors.inkMuted, fontSize: 11, marginTop: 2 },
  inlineStrong: { color: colors.ink, fontWeight: "900", textTransform: "capitalize" },
  sessionGrid: { flexDirection: "row", gap: 8 },
  infoTile: {
    flex: 1,
    minHeight: 62,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
    justifyContent: "center",
  },
  infoLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  infoValue: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: 4, textTransform: "capitalize" },
  infoSub: { color: colors.inkMuted, fontSize: 10, marginTop: 2, textTransform: "capitalize" },
  injuryBanner: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warn + "44",
    backgroundColor: colors.warn + "12",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  injuryText: { flex: 1, color: colors.warn, fontSize: 12, fontWeight: "700" },
  loadCard: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  loadTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadNumber: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  loadMeta: { marginLeft: "auto", color: colors.inkFaint, fontSize: 11, fontWeight: "800" },
  loadDetail: { color: colors.inkMuted, fontSize: 12, textTransform: "capitalize" },
  reasonList: { gap: 3 },
  reasonText: { color: colors.inkMuted, fontSize: 11 },
  chartCard: { gap: 12 },
  chartTabRow: { gap: 8, paddingRight: 2 },
  chartChip: {
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  chartChipText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900" },
  panelStack: { gap: 10 },
  metricGrid: { flexDirection: "row", gap: 8 },
  trendMetric: {
    flex: 1,
    minHeight: 76,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  metricLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  metricValue: { fontSize: 20, fontWeight: "900", marginTop: 2 },
  trendBadge: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3, marginTop: 5 },
  trendBadgeText: { fontSize: 9, fontWeight: "900" },
  noTrend: { color: colors.inkFaint, fontSize: 9, fontWeight: "800", marginTop: 6 },
  emptyChart: {
    height: 160,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: -4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 7, width: 7, borderRadius: 4 },
  legendText: { color: colors.inkFaint, fontSize: 10, fontWeight: "800" },
  insightBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  aboutBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 10,
  },
  insightTitle: { color: colors.inkFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  insightBody: { color: colors.inkMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  wellnessRow: {
    minHeight: 54,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wellnessLabel: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  wellnessSub: { color: colors.inkFaint, fontSize: 10, marginTop: 2 },
  wellnessValue: { color: colors.ink, fontSize: 15, fontWeight: "900", minWidth: 42, textAlign: "right" },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionPill: {
    minHeight: 36,
    minWidth: 72,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  optionActive: { borderColor: ROLE_THEMES.coach.accent, backgroundColor: ROLE_THEMES.coach.accentSoft },
  optionText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  optionTextActive: { color: ROLE_THEMES.coach.accentStrong },
  sessionLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sessionStatus: { color: colors.ink, fontSize: 16, fontWeight: "900", textTransform: "capitalize" },
  sessionType: { flex: 1, textAlign: "right", color: colors.inkMuted, fontSize: 12, textTransform: "capitalize" },
  rpeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  noteBox: {
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.inkFaint,
    backgroundColor: colors.surfaceInset,
    padding: 10,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  historyList: { gap: 8 },
  historyRow: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  historyMeta: { color: colors.inkFaint, fontSize: 10, marginTop: 2 },
  historyValue: { color: ROLE_THEMES.coach.accentStrong, fontSize: 18, fontWeight: "900" },
  historyUnit: { color: colors.inkFaint, fontSize: 11, fontWeight: "700" },
  activityList: { gap: 10 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  activityDot: { height: 10, width: 10, borderRadius: 5, marginTop: 3 },
  activityTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  activityDetail: { color: colors.inkMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  activityDate: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  pillText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  feedbackCard: { marginTop: 12, gap: 10 },
  composer: {
    minHeight: 78,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 12,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: "top",
  },
});
