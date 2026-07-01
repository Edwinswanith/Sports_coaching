import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Banner, Card, Muted } from "../../components/ui";
import { MessageCenter, type MessageParty, type MessageView } from "../../components/MessageCenter";
import { ScreenHeader } from "../../components/ScreenHeader";

type Athlete = {
  athleteId: string;
  name: string;
  email: string;
  sport: string;
  position: string | null;
};

type ThreadSummary = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "coach" | "athlete";
  unreadCount: number;
};

function athleteMeta(athlete?: Athlete): string {
  if (!athlete) return "Assigned athlete";
  return [athlete.sport, athlete.position].filter(Boolean).join(" / ") || athlete.email || "Assigned athlete";
}

export default function CoachMessages() {
  const accent = ROLE_THEMES.coach.accent;
  const params = useLocalSearchParams<{ athleteId?: string }>();
  const requestedId = typeof params.athleteId === "string" ? params.athleteId : null;

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showStarters, setShowStarters] = useState(false);

  const parties = useMemo<MessageParty[]>(() => {
    const athleteById = new Map(athletes.map((athlete) => [athlete.athleteId, athlete]));
    const threadIds = new Set(threads.map((thread) => thread.partyId));
    const threadParties = threads.map((thread) => {
      const athlete = athleteById.get(thread.partyId);
      return {
        id: thread.partyId,
        name: thread.partyName || athlete?.name || "Athlete",
        subtitle: athleteMeta(athlete),
        lastMessage: thread.lastMessage,
        lastAt: thread.lastAt,
        lastSenderRole: thread.lastSenderRole,
        unreadCount: thread.unreadCount,
      };
    });
    const starters = athletes
      .filter((athlete) => !threadIds.has(athlete.athleteId))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((athlete) => ({
        id: athlete.athleteId,
        name: athlete.name || "Athlete",
        subtitle: athleteMeta(athlete),
      }));
    return [...threadParties, ...starters];
  }, [athletes, threads]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, threadsRes] = await Promise.all([
        apiJson<{ athletes: Athlete[] }>("/api/coach/athletes"),
        apiJson<{ threads: ThreadSummary[] }>("/api/coach/messages/threads"),
      ]);
      setAthletes(rosterRes.athletes ?? []);
      setThreads(threadsRes.threads ?? []);
    } catch {
      setError("Couldn't load messages. Pull to retry.");
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
        `/api/coach/athletes/${selectedId}/messages?limit=50`
      );
      setMessages(res.messages ?? []);
      setThreads((prev) =>
        prev.map((thread) => (thread.partyId === selectedId ? { ...thread, unreadCount: 0 } : thread))
      );
      await apiFetch(`/api/coach/athletes/${selectedId}/messages/read`, { method: "POST" }).catch(() => undefined);
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
    if (requestedId) setSelectedId(requestedId);
  }, [requestedId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  async function send() {
    const athleteId = selectedId;
    const body = draft.trim();
    if (!athleteId || !body) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/messages`, {
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

  const unreadTotal = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  const messagedIds = new Set(threads.map((thread) => thread.partyId));
  const starters = athletes
    .filter((athlete) => !messagedIds.has(athlete.athleteId))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
        >
          <ScreenHeader
            title="Messages"
            accent={accent}
            roleLabel="Coach"
            subtitle="Direct chats with your athletes"
          />

          {loading && parties.length === 0 ? (
            <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
          ) : error ? (
            <Card>
              <Muted>{error}</Muted>
            </Card>
          ) : (
            <>
              {unreadTotal > 0 ? (
                <Banner kind="ok">
                  {unreadTotal} unread message{unreadTotal === 1 ? "" : "s"}
                </Banner>
              ) : null}
              <View style={{ height: unreadTotal > 0 ? 12 : 0 }} />

              {selectedId ? (
                <MessageCenter
                  title="Direct messages"
                  subtitle="Assigned athletes only"
                  parties={parties}
                  selectedId={selectedId}
                  messages={messages}
                  loadingMessages={threadLoading}
                  error={threadError}
                  draft={draft}
                  sending={sending}
                  accent={accent}
                  accentInk="#fff"
                  emptyPartiesText="No assigned athletes yet."
                  emptyThreadText="No messages in this conversation yet."
                  onSelect={setSelectedId}
                  onDraftChange={setDraft}
                  onSend={send}
                  maxThreadHeight={420}
                />
              ) : (
                <MessagesHome
                  threads={threads}
                  starters={starters}
                  showStarters={showStarters}
                  onToggleStarters={() => setShowStarters((value) => !value)}
                  onSelect={setSelectedId}
                />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessagesHome({
  threads,
  starters,
  showStarters,
  onToggleStarters,
  onSelect,
}: {
  threads: ThreadSummary[];
  starters: Athlete[];
  showStarters: boolean;
  onToggleStarters: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.home}>
      {threads.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="chatbubble-outline" size={19} color={colors.inkFaint} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySub}>Start one with an athlete below.</Text>
        </Card>
      ) : (
        <View style={styles.threadList}>
          {threads.map((thread) => (
            <Pressable key={thread.partyId} onPress={() => onSelect(thread.partyId)} style={styles.threadRow}>
              <Avatar name={thread.partyName} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.threadTop}>
                  <Text style={styles.threadName} numberOfLines={1}>{thread.partyName || "Athlete"}</Text>
                  <Text style={styles.threadTime}>{messageTime(thread.lastAt)}</Text>
                </View>
                <Text style={styles.threadPreview} numberOfLines={1}>
                  {thread.lastSenderRole === "coach" ? "You: " : ""}
                  {thread.lastMessage}
                </Text>
              </View>
              {thread.unreadCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{thread.unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {starters.length > 0 ? (
        <View>
          <Pressable onPress={onToggleStarters} style={styles.startHeader}>
            <Text style={styles.startLabel}>Start a conversation</Text>
            <Text style={styles.startCount}>{showStarters ? "Hide" : starters.length}</Text>
          </Pressable>
          {showStarters ? (
            <View style={styles.threadList}>
              {starters.map((athlete) => (
                <Pressable key={athlete.athleteId} onPress={() => onSelect(athlete.athleteId)} style={styles.threadRow}>
                  <Avatar name={athlete.name} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.threadName} numberOfLines={1}>{athlete.name || "Athlete"}</Text>
                    <Text style={styles.threadPreview} numberOfLines={1}>{athleteMeta(athlete)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function messageTime(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function Avatar({ name }: { name: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 28 },
  home: { gap: 18 },
  emptyCard: { minHeight: 142, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyTitle: { color: colors.inkMuted, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.inkFaint, fontSize: 13 },
  threadList: { gap: 8 },
  threadRow: {
    minHeight: 68,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  avatar: { height: 40, width: 40, borderRadius: 20, backgroundColor: ROLE_THEMES.coach.accentSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: ROLE_THEMES.coach.accentStrong, fontSize: 14, fontWeight: "900" },
  threadTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  threadName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, fontWeight: "800" },
  threadTime: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  threadPreview: { marginTop: 2, color: colors.inkMuted, fontSize: 12 },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.bad, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  startHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  startLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  startCount: { color: colors.inkFaint, fontSize: 11, fontWeight: "900" },
});
