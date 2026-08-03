import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppFrame, type NativeNavItem } from "../../components/AppFrame";
import { Card, Muted } from "../../components/ui";
import { DatePickerPill } from "../../components/DatePickerPill";
import { AskAgentControl } from "../../components/AskAgentControl";
import { Gauge } from "../../components/Gauge";
import { apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { useAutoStartMobileTour, useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

type LinkedAthlete = { athleteId: string; name: string; sport: string; position: string | null };
type AthletesResponse = { athletes: LinkedAthlete[] };
type GuardianSummary = {
  date: string;
  sleep: { quality: number | null; hours: number | null };
  attendance: { status: string | null; note: string | null };
  water: { totalMl: number; goalMl: number };
};
type Band = "green" | "amber" | "red" | "neutral";

const theme = ROLE_THEMES.guardian;
const today = () => new Date().toISOString().slice(0, 10);

const NAV: NativeNavItem[] = [{ key: "today", label: "Summary", icon: "home-outline" }];

const BAND_COLOR: Record<Band, string> = {
  green: colors.ok,
  amber: colors.warn,
  red: colors.bad,
  neutral: colors.inkFaint,
};

function litres(ml: number) {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function keyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(key: string, days: number) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return keyFromDate(date);
}


function sleepBand(quality: number | null): Band {
  if (quality === null) return "neutral";
  if (quality <= 2) return "red";
  if (quality === 3) return "amber";
  return "green";
}

function sleepLabel(quality: number | null): string {
  if (quality === null) return "No check-in yet";
  return ["", "Poor", "Fair", "Good", "Great", "Excellent"][quality] ?? "—";
}

function waterBand(pct: number, hasGoal: boolean): Band {
  if (!hasGoal) return "neutral";
  if (pct >= 90) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

function attendanceBand(status: string | null): Band {
  if (status === null) return "neutral";
  if (status === "present" || status === "rest") return "green";
  if (status === "late" || status === "excused") return "amber";
  return "red";
}

function attendanceLabel(status: string | null) {
  if (status === null) return "Not logged";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Guardian dashboard — deliberately narrow. Guardians may see ONLY three data
 * points for their linked athlete: Sleep quality, Water intake, and Attendance
 * for a given day. No readiness, training load, injuries, coach feedback, or
 * messages — see server/src/routes/guardian.ts for the matching server-side
 * restriction (the API itself never returns anything else).
 */
export default function GuardianDashboard() {
  const router = useRouter();
  useAutoStartMobileTour("guardian");
  const { highlightStyle: headerHighlight } = useTourHighlight("mobile-guardian-header");
  const { highlightStyle: switcherHighlight } = useTourHighlight("mobile-guardian-switcher");
  const { highlightStyle: sleepHighlight } = useTourHighlight("mobile-guardian-sleep");
  const { highlightStyle: waterHighlight } = useTourHighlight("mobile-guardian-water");
  const { highlightStyle: attendanceHighlight } = useTourHighlight("mobile-guardian-attendance");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const [date, setDate] = useState(today());
  const [athletes, setAthletes] = useState<LinkedAthlete[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GuardianSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarOpenSignal, setCalendarOpenSignal] = useState(0);

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

  const loadSummary = useCallback(async () => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    setError(null);
    try {
      const res = await apiJson<GuardianSummary>(`/api/guardian/athletes/${selectedId}/summary?date=${date}`);
      setSummary(res);
    } catch {
      setError("Couldn't load this athlete summary.");
    }
  }, [date, selectedId]);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const selected = athletes.find((athlete) => athlete.athleteId === selectedId) ?? null;
  const hasGoal = Boolean(summary && summary.water.goalMl > 0);
  const waterPct = summary && hasGoal ? Math.min(100, Math.round((summary.water.totalMl / summary.water.goalMl) * 100)) : 0;

  async function handleAskAgent(command: string): Promise<string> {
    const lower = command.toLowerCase();
    setError(null);
    if (/\bnotification/.test(lower)) {
      router.push("/notifications" as never);
      return "Opening notifications.";
    }
    if (/\bcalendar|calender/.test(lower)) {
      setCalendarOpenSignal((value) => value + 1);
      return "Opening calendar.";
    }
    if (/\byesterday\b/.test(lower)) {
      setDate(addDays(today(), -1));
      return "Opening yesterday.";
    }
    if (/\btomorrow\b/.test(lower)) {
      setDate(addDays(today(), 1));
      return "Opening tomorrow.";
    }
    if (/\bnext day\b/.test(lower)) {
      setDate((value) => addDays(value, 1));
      return "Opening next day.";
    }
    if (/\b(previous|prev|back) day\b/.test(lower)) {
      setDate((value) => addDays(value, -1));
      return "Opening previous day.";
    }
    if (/\bathlete|child|detail\b/.test(lower) && selectedId) {
      router.push({ pathname: "/guardian/athletes/[athleteId]", params: { athleteId: selectedId } } as never);
      return "Opening athlete details.";
    }
    const message = "Try: open calendar, next day, open athlete details, or open notifications.";
    setError(message);
    return message;
  }

  return (
    <AppFrame
      role="guardian"
      title={selected?.name ?? "Your athletes"}
      subtitle="Sleep, water & attendance only"
      nav={NAV}
      activeKey="today"
      onNavigate={() => undefined}
      headerAction={
        <SpotlightTarget id="mobile-guardian-header" style={headerHighlight}>
          <DatePickerPill value={date} onChange={setDate} openSignal={calendarOpenSignal} />
        </SpotlightTarget>
      }
    >
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAthletes} tintColor={theme.accent} />}
      >
        {error ? <Notice text={error} /> : null}

        {athletes.length > 1 ? (
          <SpotlightTarget id="mobile-guardian-switcher" style={switcherHighlight}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.athleteSwitch}>
            {athletes.map((athlete) => {
              const active = athlete.athleteId === selectedId;
              return (
                <Pressable
                  key={athlete.athleteId}
                  onPress={() => setSelectedId(athlete.athleteId)}
                  style={[styles.athleteChip, active ? { backgroundColor: theme.accent, borderColor: theme.accent } : null]}
                >
                  <View style={[styles.athleteAvatar, active ? { backgroundColor: "rgba(255,255,255,0.28)" } : null]}>
                    <Text style={[styles.athleteAvatarText, active ? { color: theme.accentInk } : null]}>
                      {initialsOf(athlete.name)}
                    </Text>
                  </View>
                  <Text style={[styles.athleteChipText, active ? { color: theme.accentInk } : null]}>{athlete.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          </SpotlightTarget>
        ) : null}

        {loading && athletes.length === 0 ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
        ) : athletes.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No linked athletes yet.</Text>
            <Muted style={{ marginTop: 4 }}>A coach links your athlete to your account.</Muted>
          </Card>
        ) : !summary ? (
          <Card>
            <Muted>No data for this date.</Muted>
          </Card>
        ) : (
          <View style={styles.stack}>
            <SpotlightTarget id="mobile-guardian-sleep" style={sleepHighlight}>
              <SleepCard quality={summary.sleep.quality} hours={summary.sleep.hours} />
            </SpotlightTarget>
            <SpotlightTarget id="mobile-guardian-water" style={waterHighlight}>
              <WaterCard totalMl={summary.water.totalMl} goalMl={summary.water.goalMl} pct={waterPct} hasGoal={hasGoal} />
            </SpotlightTarget>
            <SpotlightTarget id="mobile-guardian-attendance" style={attendanceHighlight}>
              <AttendanceCard status={summary.attendance.status} note={summary.attendance.note} />
            </SpotlightTarget>
          </View>
        )}
      </ScrollView>
      <AskAgentControl accent={theme.accent} accentInk={theme.accentInk} onCommand={handleAskAgent} />
    </AppFrame>
  );
}

function MetricIcon({ band, icon }: { band: Band; icon: keyof typeof Ionicons.glyphMap }) {
  const color = BAND_COLOR[band];
  return (
    <View style={[styles.metricIcon, { backgroundColor: `${color}1a` }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
  );
}

function Badge({ band, text }: { band: Band; text: string }) {
  const color = BAND_COLOR[band];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1a` }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function SleepCard({ quality, hours }: { quality: number | null; hours: number | null }) {
  const band = sleepBand(quality);
  const pct = quality !== null ? (quality / 5) * 100 : 0;
  return (
    <Card style={styles.metricCard}>
      <View style={styles.metricRow}>
        <Gauge pct={pct} band={band} displayValue={quality != null ? String(quality) : "—"} displayUnit="/ 5" />
        <View style={styles.metricCopy}>
          <Text style={styles.metricLabel}>Sleep quality</Text>
          <Text style={styles.metricValue}>{sleepLabel(quality)}</Text>
          {hours != null ? <Text style={styles.metricExtra}>{hours}h of sleep logged</Text> : null}
        </View>
      </View>
    </Card>
  );
}

function WaterCard({
  totalMl,
  goalMl,
  pct,
  hasGoal,
}: {
  totalMl: number;
  goalMl: number;
  pct: number;
  hasGoal: boolean;
}) {
  const band = waterBand(pct, hasGoal);
  return (
    <Card style={styles.metricCard}>
      <View style={styles.metricRow}>
        <Gauge pct={pct} band={band} displayValue={`${pct}%`} />
        <View style={styles.metricCopy}>
          <Text style={styles.metricLabel}>Water intake</Text>
          <View style={styles.metricValueRow}>
            <Text style={styles.metricValue}>{litres(totalMl)}</Text>
            <Text style={styles.metricUnit}>/ {litres(goalMl)} L goal</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

function AttendanceCard({ status, note }: { status: string | null; note: string | null }) {
  const band = attendanceBand(status);
  return (
    <Card style={styles.metricCard}>
      <View style={styles.metricRow}>
        <MetricIcon band={band} icon="checkmark-circle-outline" />
        <View style={styles.metricCopy}>
          <Text style={styles.metricLabel}>Attendance</Text>
          <Text style={styles.attendanceValue}>{attendanceLabel(status)}</Text>
          {note ? <Text style={styles.metricExtra}>{note}</Text> : null}
        </View>
        <Badge band={band} text={status ?? "—"} />
      </View>
    </Card>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 22 },
  stack: { gap: 12 },
  athleteSwitch: { gap: 8, paddingBottom: 12 },
  athleteChip: {
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
    paddingRight: 14,
  },
  athleteAvatar: {
    height: 28,
    width: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  athleteAvatarText: { fontSize: 10, fontWeight: "800", color: colors.inkMuted },
  athleteChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  notice: { borderWidth: 1, borderColor: colors.bad + "55", backgroundColor: colors.bad + "14", borderRadius: radius.md, padding: 10, marginBottom: 12 },
  noticeText: { color: colors.bad, fontSize: 13, fontWeight: "700" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  metricCard: { padding: 14 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  metricIcon: { height: 44, width: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  metricCopy: { flex: 1, minWidth: 0 },
  metricLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1.5 },
  metricValueRow: { marginTop: 3, flexDirection: "row", alignItems: "baseline", gap: 4, flexWrap: "wrap" },
  metricValue: { marginTop: 3, fontSize: 17, fontWeight: "800", color: colors.ink },
  metricUnit: { fontSize: 12, color: colors.inkFaint },
  metricExtra: { fontSize: 11, color: colors.inkMuted, marginTop: 2 },
  attendanceValue: { marginTop: 3, fontSize: 17, fontWeight: "800", color: colors.ink },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
});
