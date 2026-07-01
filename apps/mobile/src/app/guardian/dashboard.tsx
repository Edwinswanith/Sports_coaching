import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppFrame, type NativeNavItem } from "../../components/AppFrame";
import { Card, Muted } from "../../components/ui";
import { DatePickerPill } from "../../components/DatePickerPill";
import { Ring } from "../../components/Ring";
import { apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../lib/sessions";

type Section = "today" | "trends" | "feedback";
type LinkedAthlete = { athleteId: string; name: string; sport: string; position: string | null };
type AthletesResponse = { athletes: LinkedAthlete[] };
type DailyCard = {
  athleteId: string;
  name: string;
  attendance: { status: string | null };
  sessions: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  sleep?: { hours: number | null; quality: number | null };
  recovery?: { status: string | null; score: number | null };
  injury?: { active: boolean; bodyPart: string | null; restriction?: string | null };
  rpe?: {
    sessionType: SessionSlot;
    rpe: number;
    calculatedTrainingLoad: number;
    riskFlag: "green" | "amber" | "red";
    riskReasons?: string[];
  } | null;
};
type CoachComment = { _id: string; body: string };
type FeedItem = { id: string; title: string; subtitle?: string; at?: string };
type TrendPoint = {
  date: string;
  readiness?: number | null;
  load?: number | null;
  sleepHours?: number | null;
  recoveryScore?: number | null;
};

const theme = ROLE_THEMES.guardian;
const today = () => new Date().toISOString().slice(0, 10);

const NAV: NativeNavItem[] = [
  { key: "today", label: "Today", icon: "home-outline" },
  { key: "trends", label: "Trends", icon: "trending-up-outline" },
  { key: "feedback", label: "Feedback", icon: "chatbubble-outline" },
];

function dash(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function riskColor(risk: "green" | "amber" | "red") {
  if (risk === "green") return colors.ok;
  if (risk === "amber") return colors.warn;
  return colors.bad;
}

export default function GuardianDashboard() {
  const [section, setSection] = useState<Section>("today");
  const [date, setDate] = useState(today());
  const [athletes, setAthletes] = useState<LinkedAthlete[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<DailyCard | null>(null);
  const [comments, setComments] = useState<CoachComment[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAthletes = useCallback(async () => {
    setError(null);
    try {
      const res = await apiJson<AthletesResponse>("/api/guardian/athletes");
      const list = res.athletes ?? [];
      setAthletes(list);
      setSelectedId((prev) => prev ?? list[0]?.athleteId ?? null);
    } catch {
      setError("Couldn't load your athletes. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setCard(null);
      setComments([]);
      setActivity([]);
      setTrends([]);
      return;
    }
    setError(null);
    try {
      const [cardRes, commentRes, activityRes, trendRes] = await Promise.all([
        apiJson<{ card?: DailyCard }>(`/api/guardian/athletes/${selectedId}/daily-card?date=${date}`),
        apiJson<{ comments?: CoachComment[] }>(`/api/guardian/athletes/${selectedId}/coach-comments?date=${date}`).catch(() => ({ comments: [] })),
        apiJson<{ items?: FeedItem[] }>(`/api/guardian/athletes/${selectedId}/activity?limit=30`).catch(() => ({ items: [] })),
        apiJson<{ series?: TrendPoint[] }>(`/api/guardian/athletes/${selectedId}/trends?days=14`).catch(() => ({ series: [] })),
      ]);
      setCard(cardRes.card ?? null);
      setComments(commentRes.comments ?? []);
      setActivity(activityRes.items ?? []);
      setTrends(trendRes.series ?? []);
    } catch {
      setError("Couldn't load this athlete summary.");
    }
  }, [date, selectedId]);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    loadSelected();
  }, [loadSelected]);

  const selected = athletes.find((athlete) => athlete.athleteId === selectedId) ?? null;
  const nav = NAV.map((item) =>
    item.key === "feedback" ? { ...item, badge: comments.length || undefined } : item
  );

  return (
    <AppFrame
      role="guardian"
      title={selected?.name ?? "Your athletes"}
      subtitle={selected ? [selected.sport, selected.position].filter(Boolean).join(" - ") : undefined}
      nav={nav}
      activeKey={section}
      onNavigate={(key) => setSection(key as Section)}
      headerAction={<DatePickerPill value={date} onChange={setDate} />}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAthletes} tintColor={theme.accent} />}
      >
        {error ? <Notice text={error} /> : null}

        {athletes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.athleteSwitch}>
            {athletes.map((athlete) => {
              const active = athlete.athleteId === selectedId;
              return (
                <Pressable
                  key={athlete.athleteId}
                  onPress={() => setSelectedId(athlete.athleteId)}
                  style={[styles.athleteChip, active ? { backgroundColor: theme.accent, borderColor: theme.accent } : null]}
                >
                  <Text style={[styles.athleteChipText, active ? { color: theme.accentInk } : null]}>{athlete.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {loading && athletes.length === 0 ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
        ) : athletes.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No linked athletes yet.</Text>
            <Muted style={{ marginTop: 4 }}>A coach links your athlete to your account.</Muted>
          </Card>
        ) : section === "today" ? (
          <TodaySection card={card} />
        ) : section === "trends" ? (
          <TrendsSection trends={trends} />
        ) : (
          <FeedbackSection comments={comments} activity={activity} />
        )}
      </ScrollView>
    </AppFrame>
  );
}

function TodaySection({ card }: { card: DailyCard | null }) {
  if (!card) {
    return (
      <Card>
        <Muted>No data for this date.</Muted>
      </Card>
    );
  }
  return (
    <View style={styles.stack}>
      {card.injury?.active ? (
        <View style={styles.warnStrip}>
          <Text style={styles.warnText}>
            {card.injury.bodyPart}
            {card.injury.restriction ? ` - ${card.injury.restriction}` : ""}
          </Text>
        </View>
      ) : null}

      <Card style={styles.heroCard}>
        <Ring score={card.readinessScore} size={150} stroke={12} label="readiness" />
        <Text style={styles.heroText}>
          {card.readinessScore == null ? "No check-in logged yet for this date." : "Readiness indicator from today's check-in."}
        </Text>
      </Card>

      <View style={styles.statGrid}>
        <StatTile label="Sleep" value={dash(card.sleep?.hours)} sub={`quality ${dash(card.sleep?.quality)}/5`} />
        <StatTile label="Recovery" value={dash(card.recovery?.score)} sub={card.recovery?.status ?? "no data"} />
      </View>

      <Card>
        <CardTitle>{"Today's sessions"}</CardTitle>
        <Text style={styles.miniMuted}>
          Attendance <Text style={styles.inlineStrong}>{dash(card.attendance?.status)}</Text>
        </Text>
        <View style={styles.planGrid}>
          {SESSION_SLOTS.map((slot) => (
            <View key={slot} style={styles.slotPill}>
              <Text style={styles.tileLabel}>{SLOT_LABEL[slot]}</Text>
              <Text style={styles.slotType} numberOfLines={1}>{card.sessions?.[slot]?.type ?? "Rest"}</Text>
              <Text style={styles.tileSub}>{card.sessions?.[slot]?.status ?? "-"}</Text>
            </View>
          ))}
        </View>
        {card.rpe ? (
          <View style={styles.rpeBlock}>
            <View style={[styles.riskChip, { backgroundColor: riskColor(card.rpe.riskFlag) + "22" }]}>
              <Text style={[styles.riskText, { color: riskColor(card.rpe.riskFlag) }]}>{card.rpe.riskFlag}</Text>
            </View>
            <Text style={styles.rpeLoad}>{card.rpe.calculatedTrainingLoad}</Text>
            <Text style={styles.rpeMeta}>RPE {card.rpe.rpe} - {SLOT_LABEL[card.rpe.sessionType]}</Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function TrendsSection({ trends }: { trends: TrendPoint[] }) {
  const latest = trends[trends.length - 1];
  const previous = trends.length > 1 ? trends[trends.length - 2] : null;
  return (
    <View style={styles.stack}>
      <Card>
        <CardTitle>Readiness trend</CardTitle>
        {trends.length === 0 ? (
          <Muted>No trend data yet.</Muted>
        ) : (
          <>
            <View style={styles.trendRow}>
              <TrendValue label="Latest" value={dash(latest?.readiness)} />
              <TrendValue label="Previous" value={dash(previous?.readiness)} />
              <TrendValue label="Load" value={dash(latest?.load)} />
            </View>
            <View style={styles.trendList}>
              {trends.slice(-7).map((point) => (
                <View key={point.date} style={styles.trendItem}>
                  <Text style={styles.trendDate}>{point.date.slice(5)}</Text>
                  <Text style={styles.trendMetric}>Readiness {dash(point.readiness)}</Text>
                  <Text style={styles.trendMetric}>Load {dash(point.load)}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

function FeedbackSection({ comments, activity }: { comments: CoachComment[]; activity: FeedItem[] }) {
  return (
    <View style={styles.stack}>
      <Card>
        <CardTitle>Coach feedback</CardTitle>
        {comments.length === 0 ? (
          <Muted>No comments for this date.</Muted>
        ) : (
          <View style={styles.stackSmall}>
            {comments.map((comment) => (
              <View key={comment._id} style={styles.feedbackItem}>
                <Text style={styles.itemBody}>{comment.body}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>Recent activity</CardTitle>
        {activity.length === 0 ? (
          <Muted>Nothing logged recently.</Muted>
        ) : (
          <View style={styles.stackSmall}>
            {activity.slice(0, 10).map((item) => (
              <View key={item.id} style={styles.activityItem}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.itemSub}>{item.subtitle}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  );
}

function TrendValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.trendValue}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 22 },
  stack: { gap: 14 },
  stackSmall: { gap: 10, marginTop: 12 },
  athleteSwitch: { gap: 8, paddingBottom: 12 },
  athleteChip: {
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  athleteChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  notice: { borderWidth: 1, borderColor: colors.bad + "55", backgroundColor: colors.bad + "14", borderRadius: radius.md, padding: 10, marginBottom: 12 },
  noticeText: { color: colors.bad, fontSize: 13, fontWeight: "700" },
  warnStrip: { borderWidth: 1, borderColor: colors.warn + "55", backgroundColor: colors.warn + "16", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  warnText: { color: colors.warn, fontSize: 12, fontWeight: "700" },
  heroCard: { alignItems: "center", paddingVertical: 22 },
  heroText: { marginTop: 10, color: colors.inkMuted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  statGrid: { flexDirection: "row", gap: 10 },
  statTile: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  tileLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1.5 },
  tileValue: { marginTop: 7, fontSize: 22, fontWeight: "800", color: colors.ink },
  tileSub: { marginTop: 4, color: colors.inkMuted, fontSize: 11 },
  cardTitle: { color: colors.inkMuted, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 2 },
  miniMuted: { marginTop: 10, color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  inlineStrong: { color: colors.ink, fontWeight: "800" },
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  slotPill: { flexGrow: 1, flexBasis: 96, minWidth: 96, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  slotType: { marginTop: 6, color: colors.ink, fontSize: 16, fontWeight: "800" },
  rpeBlock: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 14, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  riskChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  riskText: { textTransform: "uppercase", fontSize: 10, fontWeight: "900" },
  rpeLoad: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  rpeMeta: { flex: 1, color: colors.inkFaint, fontSize: 11 },
  trendRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  trendValue: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  trendList: { gap: 8, marginTop: 12 },
  trendItem: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  trendDate: { width: 50, color: colors.ink, fontSize: 12, fontWeight: "800" },
  trendMetric: { flex: 1, color: colors.inkMuted, fontSize: 11 },
  feedbackItem: { borderLeftWidth: 3, borderLeftColor: colors.inkFaint, backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 10 },
  activityItem: { borderLeftWidth: 3, borderLeftColor: theme.accentStrong, backgroundColor: theme.accentSoft, borderRadius: radius.md, padding: 10 },
  itemBody: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  itemTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  itemSub: { color: colors.inkMuted, fontSize: 11, marginTop: 2 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
