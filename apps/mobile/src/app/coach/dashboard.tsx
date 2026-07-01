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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { SESSION_SLOTS, type SessionSlot } from "../../lib/sessions";
import { Card, Muted } from "../../components/ui";
import { ScreenHeader } from "../../components/ScreenHeader";
import { DatePickerPill } from "../../components/DatePickerPill";

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position?: string | null;
  attendance?: { status: string | null; note?: string | null };
  sessions?: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  injury?: { active: boolean; bodyPart: string | null; severity?: string | null; restriction?: string | null };
  rpe?: {
    calculatedTrainingLoad: number;
    riskFlag: "green" | "amber" | "red";
  } | null;
};

type DashboardResponse = { date: string; count: number; cards: DailyCard[] };
type SquadPoint = {
  date: string;
  avgReadiness: number | null;
  attendanceRate: number | null;
  avgLoad: number | null;
  redFlags: number;
  athleteCount: number;
};
type NotesInbox = {
  openCount: number;
  notes: { noteId: string; athleteId: string; athleteName: string; date: string; body: string; needsReply: boolean }[];
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

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function band(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "-", color: colors.inkFaint };
  if (score >= 80) return { label: String(score), color: colors.ok };
  if (score >= 60) return { label: String(score), color: colors.warn };
  return { label: String(score), color: colors.bad };
}

function riskColor(risk: "green" | "amber" | "red"): string {
  if (risk === "green") return colors.ok;
  if (risk === "amber") return colors.warn;
  return colors.bad;
}

function attentionRank(card: DailyCard): number {
  if (card.rpe?.riskFlag === "red") return 0;
  if (card.injury?.active) return 0.5;
  if (card.readinessScore !== null && card.readinessScore < 60) return 1;
  if (card.rpe?.riskFlag === "amber") return 1.5;
  if (card.readinessScore !== null && card.readinessScore < 80) return 2;
  return 3;
}

function attentionReason(card: DailyCard): string {
  if (card.rpe?.riskFlag === "red") return "High RPE risk";
  if (card.injury?.active) return card.injury.bodyPart ? `Injury - ${card.injury.bodyPart}` : "Injury";
  if (card.readinessScore !== null && card.readinessScore < 60) return `Low readiness ${card.readinessScore}`;
  if (card.rpe?.riskFlag === "amber") return "RPE caution";
  if (card.readinessScore !== null && card.readinessScore < 80) return `Readiness ${card.readinessScore}`;
  return "Check in";
}

export default function CoachDashboard() {
  const accent = ROLE_THEMES.coach.accent;
  const router = useRouter();
  const [date, setDate] = useState(() => today());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [squadSeries, setSquadSeries] = useState<SquadPoint[]>([]);
  const [notesInbox, setNotesInbox] = useState<NotesInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, squadResult, notesResult] = await Promise.allSettled([
        apiJson<DashboardResponse>(`/api/coach/dashboard?date=${date}`),
        apiJson<{ series: SquadPoint[] }>("/api/coach/analytics/squad?days=30"),
        apiJson<NotesInbox>("/api/coach/notes-inbox?days=14"),
      ]);
      if (dashboardResult.status !== "fulfilled") throw new Error("dashboard_failed");
      setData(dashboardResult.value);
      setSquadSeries(squadResult.status === "fulfilled" ? squadResult.value.series ?? [] : []);
      setNotesInbox(notesResult.status === "fulfilled" ? notesResult.value : null);
    } catch {
      setError("Couldn't load your squad. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);
  const ranked = useMemo(
    () =>
      [...cards].sort(
        (a, b) => attentionRank(a) - attentionRank(b) || (a.readinessScore ?? 101) - (b.readinessScore ?? 101)
      ),
    [cards]
  );
  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((card) => {
      if (
        q &&
        !card.name.toLowerCase().includes(q) &&
        !(card.sport ?? "").toLowerCase().includes(q) &&
        !(card.position ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === "attention") return attentionRank(card) < 2;
      if (filter === "injury") return Boolean(card.injury?.active);
      if (filter === "nocheck") return card.readinessScore === null;
      return true;
    });
  }, [filter, query, ranked]);
  const attentionCards = ranked.filter((card) => attentionRank(card) < 2);
  const present = cards.filter((card) => card.attendance?.status === "present").length;
  const completed = cards.filter((card) =>
    SESSION_SLOTS.some((slot) => card.sessions?.[slot]?.status === "completed")
  ).length;
  const withReadiness = cards.filter((card) => card.readinessScore != null);
  const avg =
    withReadiness.length > 0
      ? Math.round(withReadiness.reduce((sum, card) => sum + (card.readinessScore ?? 0), 0) / withReadiness.length)
      : null;
  const headerSubtitle =
    cards.length === 0
      ? "No athletes assigned"
      : `${cards.length} athlete${cards.length === 1 ? "" : "s"} - ${attentionCards.length} need attention`;

  function openAthlete(card: DailyCard) {
    router.push({
      pathname: "/coach/athletes/[athleteId]",
      params: { athleteId: card.athleteId, name: card.name },
    } as never);
  }

  const filterCounts = useMemo(
    () => ({
      attention: cards.filter((card) => attentionRank(card) < 2).length,
      injury: cards.filter((card) => card.injury?.active).length,
      nocheck: cards.filter((card) => card.readinessScore === null).length,
    }),
    [cards]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <ScreenHeader
          title="Squad readiness"
          accent={accent}
          roleLabel="Coach"
          subtitle={headerSubtitle}
          dense
          inlineActions
          headerActions={
            <View style={styles.headerActionRow}>
              <DatePickerPill value={date} onChange={setDate} accent={accent} accentInk="#fff" compact />
              <Pressable
                onPress={() => router.push("/coach/athletes/new" as never)}
                style={[styles.addButton, { backgroundColor: accent }]}
                accessibilityLabel="Add athlete"
              >
                <Text style={styles.addButtonText}>+ Add</Text>
              </Pressable>
            </View>
          }
        />

        {loading && !data ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Muted>{error}</Muted>
          </Card>
        ) : (
          <>
            <View style={styles.statGrid}>
              <Stat label="Athletes" value={String(data?.count ?? 0)} />
              <Stat label="Present" value={String(present)} />
              <Stat label="Sessions done" value={String(completed)} />
              <Stat label="Avg readiness" value={avg == null ? "-" : String(avg)} highlight={band(avg).color} />
            </View>

            {cards.length > 0 ? (
              <>
                {attentionCards.length > 0 ? (
                  <Card style={styles.attentionCard}>
                    <View style={styles.sectionRow}>
                      <Text style={[styles.sectionLabel, { color: colors.bad }]}>Needs attention</Text>
                      <Text style={styles.sectionCount}>{attentionCards.length}</Text>
                    </View>
                    <View style={styles.attentionList}>
                      {attentionCards.map((card) => (
                        <Pressable key={card.athleteId} onPress={() => openAthlete(card)} style={styles.attentionPill}>
                          <View style={[styles.attentionDot, { backgroundColor: band(card.readinessScore).color }]} />
                          <Text style={styles.attentionName} numberOfLines={1}>{card.name || "Athlete"}</Text>
                          <Text style={styles.attentionReason} numberOfLines={1}>{attentionReason(card)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </Card>
                ) : null}

                <CoachNotesInbox inbox={notesInbox} onOpen={(athleteId) => {
                  const card = cards.find((item) => item.athleteId === athleteId);
                  if (card) openAthlete(card);
                }} />

                <SquadTrendCard series={squadSeries} />

                <View style={styles.rosterHeader}>
                  <Text style={styles.rosterTitle}>Full roster</Text>
                  <Text style={styles.rosterMeta}>{filteredCards.length} of {cards.length}</Text>
                </View>

                <View style={styles.searchBlock}>
                  <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={17} color={colors.inkFaint} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search name, sport, position..."
                      placeholderTextColor={colors.inkFaint}
                      style={styles.searchInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {ROSTER_FILTERS.map((item) => {
                      const active = item.key === filter;
                      const count =
                        item.key === "attention"
                          ? filterCounts.attention
                          : item.key === "injury"
                          ? filterCounts.injury
                          : item.key === "nocheck"
                          ? filterCounts.nocheck
                          : 0;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => setFilter(item.key)}
                          style={[styles.filterChip, active ? { backgroundColor: accent, borderColor: accent } : null]}
                        >
                          <Text style={[styles.filterText, active ? { color: "#fff" } : null]}>
                            {item.label}
                            {item.key !== "all" && count > 0 ? ` ${count}` : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {filteredCards.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {filteredCards.map((card) => (
                      <RosterRow key={card.athleteId} card={card} onPress={() => openAthlete(card)} />
                    ))}
                  </View>
                ) : (
                  <Card>
                    <Muted>No athletes match the current search or filter.</Muted>
                  </Card>
                )}
              </>
            ) : (
              <Card style={{ marginTop: 8 }}>
                <Text style={styles.emptyTitle}>No athletes on your squad yet.</Text>
                <Muted style={{ marginTop: 4 }}>Add athletes from the roster screen and they will appear here.</Muted>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CoachNotesInbox({ inbox, onOpen }: { inbox: NotesInbox | null; onOpen: (athleteId: string) => void }) {
  const notes = inbox?.notes ?? [];
  const open = inbox?.openCount ?? 0;
  return (
    <Card style={styles.notesCard}>
      <View style={styles.sectionRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.rosterTitle}>Athlete notes</Text>
          {notes.length > 0 ? <Chip label={open > 0 ? `${open} need reply` : "all replied"} color={open > 0 ? colors.warn : colors.ok} /> : null}
        </View>
        <Text style={styles.sectionCount}>14d</Text>
      </View>
      {inbox === null ? (
        <Text style={styles.noteEmpty}>Notes could not be loaded.</Text>
      ) : notes.length === 0 ? (
        <Text style={styles.noteEmpty}>No athlete notes in the last 14 days.</Text>
      ) : (
        <View style={styles.notesList}>
          {notes.slice(0, 4).map((note) => (
            <Pressable key={note.noteId} onPress={() => onOpen(note.athleteId)} style={styles.noteRow}>
              <View style={styles.noteTop}>
                <Text style={styles.noteName} numberOfLines={1}>{note.athleteName}</Text>
                <Chip label={note.needsReply ? "needs reply" : "replied"} color={note.needsReply ? colors.warn : colors.ok} />
                <Text style={styles.noteDate}>{shortDate(note.date)}</Text>
              </View>
              <Text style={styles.noteBody} numberOfLines={2}>{note.body}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

function SquadTrendCard({ series }: { series: SquadPoint[] }) {
  const points = series.slice(-14);
  const latest = series.length > 0 ? series[series.length - 1] : null;
  const maxLoad = Math.max(1, ...points.map((point) => point.avgLoad ?? 0));
  return (
    <Card style={styles.trendCard}>
      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.rosterTitle}>Squad analytics</Text>
          <Text style={styles.trendSubtitle}>
            {latest ? `${latest.athleteCount} logging - ${latest.redFlags} red flag${latest.redFlags === 1 ? "" : "s"}` : "Across assigned athletes"}
          </Text>
        </View>
        <Text style={styles.sectionCount}>30d</Text>
      </View>
      {points.length === 0 ? (
        <Text style={styles.noteEmpty}>No trend data yet.</Text>
      ) : (
        <>
          <View style={styles.trendTiles}>
            <MiniMetric label="Readiness" value={latest?.avgReadiness == null ? "-" : String(Math.round(latest.avgReadiness))} color={colors.ok} />
            <MiniMetric label="Attendance" value={latest?.attendanceRate == null ? "-" : `${Math.round(latest.attendanceRate)}%`} color="#2f7df6" />
            <MiniMetric label="Avg load" value={latest?.avgLoad == null ? "-" : String(Math.round(latest.avgLoad))} color={colors.warn} />
          </View>
          <View style={styles.chart}>
            {points.map((point) => {
              const readiness = Math.max(4, Math.round(((point.avgReadiness ?? 0) / 100) * 72));
              const attendance = Math.max(4, Math.round(((point.attendanceRate ?? 0) / 100) * 72));
              const load = Math.max(4, Math.round(((point.avgLoad ?? 0) / maxLoad) * 72));
              return (
                <View key={point.date} style={styles.chartGroup}>
                  <View style={[styles.chartBar, { height: load, backgroundColor: colors.warn + "55" }]} />
                  <View style={[styles.chartBar, { height: readiness, backgroundColor: colors.ok + "88" }]} />
                  <View style={[styles.chartBar, { height: attendance, backgroundColor: "#2f7df688" }]} />
                </View>
              );
            })}
          </View>
          <View style={styles.legendRow}>
            <Legend color={colors.warn} label="Load" />
            <Legend color={colors.ok} label="Readiness" />
            <Legend color="#2f7df6" label="Attendance" />
          </View>
        </>
      )}
    </Card>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniMetricLabel}>{label}</Text>
      <Text style={[styles.miniMetricValue, { color }]}>{value}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight ? { color: highlight } : null]}>{value}</Text>
    </Card>
  );
}

function RosterRow({ card, onPress }: { card: DailyCard; onPress: () => void }) {
  const readiness = band(card.readinessScore);
  const flagged = attentionRank(card) < 2;
  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.athleteCard, flagged ? { borderColor: readiness.color + "55" } : null]}>
        <View style={[styles.scoreDot, { borderColor: readiness.color + "66" }]}>
          <Text style={[styles.scoreText, { color: readiness.color }]}>{readiness.label}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.athleteName} numberOfLines={1}>{card.name || "Athlete"}</Text>
            {card.injury?.active ? <Chip label="Injury" color={colors.bad} /> : null}
            {card.rpe ? <Chip label={card.rpe.riskFlag} color={riskColor(card.rpe.riskFlag)} /> : null}
          </View>
          <Text style={styles.athleteSport} numberOfLines={1}>
            {[card.sport, card.position, card.attendance?.status].filter(Boolean).join(" - ") || "-"}
          </Text>
        </View>
        <View style={styles.loadBlock}>
          {card.rpe ? (
            <>
              <Text style={styles.loadValue}>{card.rpe.calculatedTrainingLoad}</Text>
              <Text style={styles.loadLabel}>load</Text>
            </>
          ) : (
            <Text style={styles.noRpe}>No RPE</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Card>
    </Pressable>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color + "18" }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 26 },
  headerActionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  addButton: { height: 38, borderRadius: radius.md, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  stat: { flexGrow: 1, flexBasis: "47%", padding: 12 },
  statLabel: { fontSize: 10, color: colors.inkMuted, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 4 },
  attentionCard: { marginBottom: 16, gap: 10 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  sectionCount: { color: colors.inkFaint, fontSize: 12, fontWeight: "800" },
  attentionList: { gap: 8 },
  attentionPill: {
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  attentionDot: { height: 8, width: 8, borderRadius: 4 },
  attentionName: { maxWidth: 110, color: colors.ink, fontSize: 12, fontWeight: "800" },
  attentionReason: { flex: 1, color: colors.inkMuted, fontSize: 11 },
  rosterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  rosterTitle: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  rosterMeta: { color: colors.inkFaint, fontSize: 11, fontWeight: "700" },
  searchBlock: { gap: 8, marginBottom: 12 },
  searchWrap: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  filterRow: { gap: 6, paddingRight: 2 },
  filterChip: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  filterText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  notesCard: { marginBottom: 16, gap: 10 },
  notesList: { gap: 8 },
  noteEmpty: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
  noteRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  noteTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, fontWeight: "800" },
  noteDate: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  noteBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  trendCard: { marginBottom: 16, gap: 12 },
  trendSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 3 },
  trendTiles: { flexDirection: "row", gap: 8 },
  miniMetric: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  miniMetricLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  miniMetricValue: { fontSize: 18, fontWeight: "900", marginTop: 2 },
  chart: {
    height: 86,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceInset,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chartGroup: { flex: 1, minWidth: 8, height: 72, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 2 },
  chartBar: { width: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legend: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { color: colors.inkFaint, fontSize: 10, fontWeight: "800" },
  athleteCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  scoreDot: { height: 42, width: 42, borderRadius: 21, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  scoreText: { fontSize: 13, fontWeight: "900" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  athleteName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  athleteSport: { fontSize: 13, color: colors.inkMuted, marginTop: 2, textTransform: "capitalize" },
  chip: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  loadBlock: { minWidth: 52, alignItems: "flex-end" },
  loadValue: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  loadLabel: { color: colors.inkFaint, fontSize: 10 },
  noRpe: { color: colors.inkFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
