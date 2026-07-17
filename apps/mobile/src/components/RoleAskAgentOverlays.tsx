import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Text } from "./AppText";
import { AskAgentControl } from "./AskAgentControl";
import { apiFetch, apiJson } from "../lib/api";
import { ROLE_THEMES, colors } from "../lib/theme";
import { SESSION_SLOTS } from "../lib/sessions";

type AgentRow = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  status: string;
  detail: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  onPress?: () => void;
};

type AgentResult = {
  title: string;
  subtitle: string;
  summary: string;
  rows: AgentRow[];
};

type CoachCard = {
  athleteId: string;
  name: string;
  sport?: string | null;
  position?: string | null;
  attendance?: { status: string | null };
  sessions?: Record<string, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  injury?: { active: boolean; bodyPart: string | null };
  rpe?: { calculatedTrainingLoad: number; riskFlag: "green" | "amber" | "red" } | null;
};

type CoachDashboardResponse = { date: string; count: number; cards: CoachCard[] };

const today = () => new Date().toISOString().slice(0, 10);

function toneColor(tone: AgentRow["tone"]) {
  if (tone === "ok") return colors.ok;
  if (tone === "warn") return colors.warn;
  if (tone === "bad") return colors.bad;
  return colors.inkMuted;
}

function normalizeCommand(command: string) {
  return command.toLowerCase().replace(/\bcouch\b/g, "coach").trim();
}

function attentionRank(card: CoachCard): number {
  if (card.rpe?.riskFlag === "red") return 0;
  if (card.injury?.active) return 0.5;
  if (card.readinessScore !== null && card.readinessScore < 60) return 1;
  if (card.rpe?.riskFlag === "amber") return 1.5;
  if (card.readinessScore !== null && card.readinessScore < 80) return 2;
  return 3;
}

function attentionReason(card: CoachCard): string {
  if (card.rpe?.riskFlag === "red") return "High RPM risk";
  if (card.injury?.active) return card.injury.bodyPart ? `Injury - ${card.injury.bodyPart}` : "Injury";
  if (card.readinessScore !== null && card.readinessScore < 60) return `Low readiness ${card.readinessScore}`;
  if (card.rpe?.riskFlag === "amber") return "RPM caution";
  if (card.readinessScore !== null && card.readinessScore < 80) return `Readiness ${card.readinessScore}`;
  return "Ready";
}

function extractAnnouncementBody(command: string): string | null {
  const cleaned = command.trim().replace(/\bcouch\b/gi, "coach");
  const target = String.raw`(?:all\s+)?(?:team|squad|athlete|athletes|player|players)`;
  const patterns = [
    new RegExp(String.raw`^(?:send|sent|post|create|make)?\s*(?:an?\s*)?(?:announce(?:ment)?|announcements|broadcast)(?:\s+message)?(?:\s+to\s+${target})?(?:\s+that|\s+saying|:|\s+of)?\s+(.+)$`, "i"),
    new RegExp(String.raw`^(?:send|sent|post|create|make)?\s*(?:a\s*)?message\s+(?:of|for|as)\s+(?:an?\s*)?(?:announce(?:ment)?|broadcast)(?:\s+to\s+${target})?(?:\s+that|\s+saying|:|\s+of)?\s+(.+)$`, "i"),
    new RegExp(String.raw`^(?:send|sent|post)\s+(.+?)\s+(?:as\s+|of\s+)?(?:an?\s*)?(?:announce(?:ment)?|broadcast)(?:\s+to\s+${target})?$`, "i"),
  ];
  for (const pattern of patterns) {
    const body = cleaned.match(pattern)?.[1]?.trim();
    if (body) return body.replace(/^(?:to\s+)?all\s+(?:athlete|athletes|players|team|squad)\s+(?:of|that|saying)\s+/i, "").trim();
  }
  return null;
}

function parseWaterAmountMl(command: string): number | null {
  const lower = command.toLowerCase();
  const litre = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|litre|liter|litres|liters)\b/);
  if (litre) return Math.round(Number(litre[1]) * 1000);
  const ml = lower.match(/(\d+)\s*(?:ml|millilitre|milliliter|millilitres|milliliters)\b/);
  if (ml) return Number(ml[1]);
  const plain = lower.match(/\b(?:add|log|drink|drank)\s+(\d{2,4})\b/);
  return plain ? Number(plain[1]) : null;
}

function extractCoachMessage(command: string): string | null {
  const cleaned = command.trim().replace(/\bcouch\b/gi, "coach");
  const match = cleaned.match(/^(?:send|sent|message|text)\s+(.+?)\s+to\s+(?:my\s+)?coach$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  const reverse = cleaned.match(/^(?:send|sent|message|text)\s+(?:my\s+)?coach\s+(.+)$/i);
  if (reverse?.[1]?.trim()) return reverse[1].trim();
  return null;
}

function extractNoteBody(command: string): string | null {
  const match = command.match(/^(?:add|create|save|write)\s+(?:a\s+)?(?:session\s+)?note(?:\s+for)?\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function AgentResultSheet({ result, onClose }: { result: AgentResult | null; onClose: () => void }) {
  if (!result) return null;
  return (
    <View style={styles.sheetOverlay} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sheetTitle}>{result.title}</Text>
            <Text style={styles.sheetSubtitle}>{result.subtitle}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close result">
            <Ionicons name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        </View>
        <View style={styles.summary}>
          <Ionicons name="sparkles-outline" size={15} color={colors.ok} />
          <Text style={styles.summaryText}>{result.summary}</Text>
        </View>
        {result.rows.length ? (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.headText}>Item</Text>
              <Text style={styles.headStatus}>Status</Text>
            </View>
            <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.rows} showsVerticalScrollIndicator>
              {result.rows.map((row) => {
                const color = toneColor(row.tone);
                return (
                  <Pressable
                    key={row.id}
                    onPress={row.onPress}
                    disabled={!row.onPress}
                    style={({ pressed }) => [styles.row, row.onPress ? styles.rowAction : null, pressed ? { opacity: 0.82 } : null]}
                    accessibilityRole={row.onPress ? "button" : undefined}
                    accessibilityLabel={row.onPress ? `Open ${row.label}` : undefined}
                  >
                    <View style={[styles.iconBox, { backgroundColor: `${color}16`, borderColor: `${color}44` }]}>
                      <Ionicons name={row.icon} size={16} color={color} />
                    </View>
                    <View style={styles.mainCell}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                      <Text style={styles.rowDetail} numberOfLines={2}>{row.detail}</Text>
                    </View>
                    <View style={[styles.statusPill, { borderColor: `${color}44`, backgroundColor: `${color}12` }]}>
                      <Text style={[styles.statusText, { color }]} numberOfLines={1}>{row.status}</Text>
                    </View>
                    {row.onPress ? <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
}

export function CoachAskAgentOverlay() {
  const router = useRouter();
  const accent = ROLE_THEMES.coach.accent;
  const [result, setResult] = useState<AgentResult | null>(null);
  const [inputOpen, setInputOpen] = useState(false);

  async function loadDashboard() {
    return apiJson<CoachDashboardResponse>(`/api/coach/dashboard?date=${today()}`);
  }

  function athleteRows(cards: CoachCard[], empty: string): AgentRow[] {
    if (!cards.length) {
      return [{ id: "empty", icon: "checkmark-done-outline", label: empty, status: "0", detail: "No matching athletes found.", tone: "ok" }];
    }
    return cards.map((card) => ({
      id: card.athleteId,
      icon: card.injury?.active ? "medkit-outline" : card.attendance?.status === "absent" ? "close-circle-outline" : "person-outline",
      label: card.name || "Athlete",
      status: card.readinessScore == null ? "-" : String(card.readinessScore),
      detail: [card.sport, card.position, card.attendance?.status, attentionReason(card)].filter(Boolean).join(" · "),
      tone: card.injury?.active || card.attendance?.status === "absent" ? "bad" : attentionRank(card) < 2 ? "warn" : "ok",
      onPress: () => router.push({ pathname: "/coach/athletes/[athleteId]", params: { athleteId: card.athleteId, name: card.name } } as never),
    }));
  }

  async function showCoachReport(kind: "summary" | "best" | "roster" | "absent" | "injury" | "attention") {
    const data = await loadDashboard();
    const cards = data.cards ?? [];
    const present = cards.filter((card) => card.attendance?.status === "present").length;
    const completed = cards.filter((card) => SESSION_SLOTS.some((slot) => card.sessions?.[slot]?.status === "completed")).length;
    const avgCards = cards.filter((card) => card.readinessScore != null);
    const avg = avgCards.length ? Math.round(avgCards.reduce((sum, card) => sum + (card.readinessScore ?? 0), 0) / avgCards.length) : null;
    const best = [...cards].sort((a, b) => {
      const aSessions = SESSION_SLOTS.filter((slot) => a.sessions?.[slot]?.status === "completed").length;
      const bSessions = SESSION_SLOTS.filter((slot) => b.sessions?.[slot]?.status === "completed").length;
      return (b.readinessScore ?? 0) + bSessions * 8 - attentionRank(b) * 10 - ((a.readinessScore ?? 0) + aSessions * 8 - attentionRank(a) * 10);
    })[0];
    const attention = cards.filter((card) => attentionRank(card) < 2);
    const absent = cards.filter((card) => card.attendance?.status === "absent");
    const injured = cards.filter((card) => card.injury?.active);
    const rows =
      kind === "best" && best ? athleteRows([best], "No athlete data")
      : kind === "roster" ? athleteRows(cards, "No athletes")
      : kind === "absent" ? athleteRows(absent, "No absent athletes")
      : kind === "injury" ? athleteRows(injured, "No injured athletes")
      : kind === "attention" ? athleteRows(attention, "No athletes need attention")
      : [
          { id: "athletes", icon: "people-outline" as const, label: "Athletes", status: String(cards.length), detail: `${present} present today.`, tone: "neutral" as const, onPress: () => router.push("/coach/athletes" as never) },
          { id: "sessions", icon: "checkmark-done-outline" as const, label: "Sessions done", status: String(completed), detail: `${completed} completed session entries.`, tone: completed ? "ok" as const : "warn" as const },
          { id: "readiness", icon: "pulse-outline" as const, label: "Avg readiness", status: avg == null ? "-" : String(avg), detail: "Current squad readiness average.", tone: avg == null ? "neutral" as const : avg >= 75 ? "ok" as const : avg >= 60 ? "warn" as const : "bad" as const },
        ];
    setResult({
      title: kind === "best" ? "Best Athlete" : kind === "roster" ? "Athlete List" : kind === "absent" ? "Absent Athletes" : kind === "injury" ? "Injury Report" : kind === "attention" ? "Attention Report" : "Squad Report",
      subtitle: data.date,
      summary: kind === "best" && best ? `${best.name} is top today.` : `${cards.length} athletes · ${present} present · ${completed} sessions done · readiness ${avg ?? "-"}`,
      rows,
    });
  }

  async function sendAnnouncement(body: string) {
    const res = await apiFetch("/api/coach/announcements", { method: "POST", body: JSON.stringify({ body }) });
    if (!res.ok) throw new Error("announce_failed");
    setResult({
      title: "Announcement Sent",
      subtitle: today(),
      summary: body,
      rows: [{ id: "announcement", icon: "megaphone-outline", label: "Squad announcement", status: "Sent", detail: "Broadcast to assigned athletes.", tone: "ok", onPress: () => router.push("/coach/announcements" as never) }],
    });
  }

  async function handleCommand(command: string) {
    const lower = normalizeCommand(command);
    setResult(null);
    try {
      const announcementBody = extractAnnouncementBody(command);
      if (announcementBody) {
        await sendAnnouncement(announcementBody);
        return;
      }
      if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) return router.push("/notifications" as never);
      if (/\b(calendar|calender|date picker|pick date)\b/.test(lower)) {
        return router.push({ pathname: "/coach/dashboard", params: { ask: "calendar", t: String(Date.now()) } } as never);
      }
      if (/\b(message|messages|chat|inbox|dm|direct)\b/.test(lower)) return router.push("/coach/messages" as never);
      if (/\b(announce|announcement|announcements|broadcast)\b/.test(lower)) return router.push("/coach/announcements" as never);
      if (/^(open|go to)\s+(?:the\s+)?(?:roster|athletes|athlete list|players|squad list|team list)\b/.test(lower)) {
        return router.push("/coach/athletes" as never);
      }
      if (/\b(add|create|new|invite)\b.*\b(athlete|player|student)\b/.test(lower)) return router.push("/coach/athletes/new" as never);
      if (/\b(report|reports|summary|readiness|attendance|present|load|sessions?)\b/.test(lower)) return showCoachReport("summary");
      if (/\b(roster|athletes|athlete list|players|squad list|team list|listout|list out)\b/.test(lower)) return showCoachReport("roster");
      if (/\b(absent|absented|absence|not present|missing today)\b/.test(lower)) return showCoachReport("absent");
      if (/\b(injury|injuries|injured|hurt|pain)\b/.test(lower)) return showCoachReport("injury");
      if (/\b(attention|risk|flag|low readiness|need attention)\b/.test(lower)) return showCoachReport("attention");
      if (/\b(best|top|strongest|highest|leader)\b/.test(lower)) return showCoachReport("best");
      setResult({ title: "Ask Agent", subtitle: "Coach commands", summary: "Try: who is best athlete, list athletes, who is absent, show injury report, or announce practice at 7 AM.", rows: [] });
    } catch {
      setResult({ title: "Ask Agent", subtitle: "Coach commands", summary: "I could not complete that command. Please try again.", rows: [] });
    }
  }

  return (
    <>
      <AskAgentControl
        accent={accent}
        accentInk="#fff"
        onCommand={handleCommand}
        onInputOpenChange={setInputOpen}
        onListeningChange={(listening) => {
          if (listening) setResult(null);
        }}
        tourTargetId="mobile-coach-agent"
      />
      {!inputOpen ? <AgentResultSheet result={result} onClose={() => setResult(null)} /> : null}
    </>
  );
}

export function AthleteAskAgentOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const accent = ROLE_THEMES.athlete.accent;
  const accentInk = ROLE_THEMES.athlete.accentInk;
  const [result, setResult] = useState<AgentResult | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const hidden = useMemo(() => pathname === "/athlete/dashboard", [pathname]);

  function openDashboard(section: string) {
    router.push({ pathname: "/athlete/dashboard", params: { section } } as never);
  }

  async function sendCoachMessage(body: string) {
    const coachRes = await apiJson<{ coaches: { coachId: string; name?: string }[] }>("/api/athlete/coaches");
    const coach = coachRes.coaches?.[0];
    if (!coach) {
      openDashboard("messages");
      throw new Error("no_coach");
    }
    const res = await apiFetch(`/api/athlete/messages/${coach.coachId}`, { method: "POST", body: JSON.stringify({ body }) });
    if (!res.ok) throw new Error("message_failed");
    setResult({
      title: "Message Sent",
      subtitle: coach.name || "Coach",
      summary: body,
      rows: [{ id: "message", icon: "chatbubble-ellipses-outline", label: "Coach message", status: "Sent", detail: "Direct message sent to coach.", tone: "ok", onPress: () => openDashboard("chat") }],
    });
  }

  async function handleCommand(command: string) {
    const lower = normalizeCommand(command);
    setResult(null);
    try {
      if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) return router.push("/notifications" as never);
      if (/\b(calendar|calender|today|readiness|status)\b/.test(lower) && /^(open|show|go to)/.test(lower)) return openDashboard("today");
      if (/\b(water|hydrat|drink)\b/.test(lower) && /^(open|show|go to)/.test(lower)) return openDashboard("water");
      if (/\b(trend|trends|report|progress|goal|goals|achievement|achievements)\b/.test(lower) && /^(open|show|go to)/.test(lower)) return openDashboard(lower.includes("trend") ? "trends" : "progress");
      if (/\b(log|training|session|rpm|recovery)\b/.test(lower) && /^(open|show|go to)/.test(lower)) return openDashboard("log");
      if (/\b(coach|message|messages|chat)\b/.test(lower) && /^(open|show|go to)/.test(lower)) return openDashboard("messages");

      const waterAmount = parseWaterAmountMl(command);
      if (waterAmount && /\b(water|drink|drank|hydrat)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/water", { method: "POST", body: JSON.stringify({ date: today(), amountMl: waterAmount }) });
        if (!res.ok) throw new Error("water_failed");
        setResult({ title: "Water Logged", subtitle: today(), summary: `Logged ${waterAmount} ml of water.`, rows: [{ id: "water", icon: "water-outline", label: "Hydration", status: `${waterAmount} ml`, detail: "Added to today's water total.", tone: "ok", onPress: () => openDashboard("water") }] });
        return;
      }
      if (/\b(set|mark)\b.*\b(rest day|rest)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/rest-day", { method: "POST", body: JSON.stringify({ date: today(), enabled: true }) });
        if (!res.ok) throw new Error("rest_failed");
        setResult({ title: "Rest Day Set", subtitle: today(), summary: "Today is set as a rest day.", rows: [{ id: "rest", icon: "moon-outline", label: "Rest day", status: "On", detail: "Training inputs are paused for today.", tone: "ok", onPress: () => openDashboard("log") }] });
        return;
      }
      if (/\b(remove|clear|turn off|disable)\b.*\b(rest day|rest)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/rest-day", { method: "POST", body: JSON.stringify({ date: today(), enabled: false }) });
        if (!res.ok) throw new Error("rest_clear_failed");
        setResult({ title: "Rest Day Removed", subtitle: today(), summary: "Rest day was removed for today.", rows: [{ id: "rest", icon: "barbell-outline", label: "Training log", status: "Open", detail: "Training inputs are available again.", tone: "ok", onPress: () => openDashboard("log") }] });
        return;
      }
      const coachMessage = extractCoachMessage(command);
      if (coachMessage) {
        await sendCoachMessage(coachMessage);
        return;
      }
      const noteBody = extractNoteBody(command);
      if (noteBody) {
        const res = await apiFetch("/api/athlete/notes", { method: "POST", body: JSON.stringify({ date: today(), body: noteBody }) });
        if (!res.ok) throw new Error("note_failed");
        setResult({ title: "Note Saved", subtitle: today(), summary: noteBody, rows: [{ id: "note", icon: "document-text-outline", label: "Session note", status: "Saved", detail: "Added to today's athlete notes.", tone: "ok", onPress: () => openDashboard("log") }] });
        return;
      }
      setResult({ title: "Ask Agent", subtitle: "Athlete commands", summary: "Try: open water, add 250 ml water, set today rest day, send hello to coach, or add session note ...", rows: [] });
    } catch {
      setResult({ title: "Ask Agent", subtitle: "Athlete commands", summary: "I could not complete that command. Please try again.", rows: [] });
    }
  }

  if (hidden) return null;
  return (
    <>
      <AskAgentControl accent={accent} accentInk={accentInk} onCommand={handleCommand} onInputOpenChange={setInputOpen} onListeningChange={(listening) => listening && setResult(null)} />
      {!inputOpen ? <AgentResultSheet result={result} onClose={() => setResult(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 3000,
    elevation: 50,
    justifyContent: "flex-end",
  },
  sheet: {
    marginHorizontal: 16,
    marginBottom: 96,
    maxHeight: 310,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: colors.ink },
  sheetSubtitle: { marginTop: 1, fontSize: 12, fontWeight: "700", color: colors.inkMuted },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
  },
  summary: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#9bcfbe",
    backgroundColor: "#eaf7f1",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryText: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  tableHead: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  headText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  headStatus: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  rowsScroll: { marginTop: 6 },
  rows: { gap: 7, paddingBottom: 4 },
  row: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowAction: { backgroundColor: "#f8faf7" },
  iconBox: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  mainCell: { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  rowDetail: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  statusPill: {
    minWidth: 66,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: { fontSize: 12, fontWeight: "900" },
});
