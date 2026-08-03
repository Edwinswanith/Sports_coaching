import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Banner, Card, Muted, PrimaryButton } from "../../components/ui";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

type Announcement = { id?: string; body: string; recipientCount?: number; createdAt?: string };
type AnnouncementsResponse = { announcements: Announcement[] };
type RosterResponse = { athletes: { athleteId: string }[] };

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Announcements() {
  const { highlightStyle: announceHighlight } = useTourHighlight("mobile-coach-announce");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const accent = ROLE_THEMES.coach.accent;
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [recipientCount, setRecipientCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [announcementResult, rosterResult] = await Promise.allSettled([
        apiJson<AnnouncementsResponse>("/api/coach/announcements"),
        apiJson<RosterResponse>("/api/coach/athletes"),
      ]);
      if (announcementResult.status !== "fulfilled") throw new Error("announcements_failed");
      setItems(announcementResult.value.announcements);
      if (rosterResult.status === "fulfilled") {
        setRecipientCount(rosterResult.value.athletes.length);
      }
    } catch {
      setError("Couldn't load announcements. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post() {
    setPostError(null);
    const body = draft.trim();
    if (!body) return false;
    setPosting(true);
    try {
      const res = await apiFetch("/api/coach/announcements", {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setPostError("Couldn't post. Try again.");
        return false;
      }
      setDraft("");
      load();
      return true;
    } catch {
      setPostError("Network error. Please try again.");
      return false;
    } finally {
      setPosting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={tourScrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
        >
          <ScreenHeader
            title="Announcements"
            accent={accent}
            roleLabel="Coach"
            subtitle="Broadcast to your whole squad"
          />

          <SpotlightTarget id="mobile-coach-announce" style={announceHighlight}>
          <Card style={styles.composeCard}>
            <Text style={styles.cardTitle}>Message your squad</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder='e.g. "Sunday swimming class starts at 7:00 AM."'
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={1000}
              editable={!posting}
              style={styles.compose}
            />
            <View style={styles.composeMeta}>
              <Text style={styles.helper}>
                Goes to all {recipientCount} assigned athlete{recipientCount === 1 ? "" : "s"}
              </Text>
              <Text style={styles.helper}>{1000 - draft.length}</Text>
            </View>
            {postError ? <Banner kind="error">{postError}</Banner> : null}
            <PrimaryButton
              label={`Send to ${recipientCount} athlete${recipientCount === 1 ? "" : "s"}`}
              onPress={post}
              loading={posting}
              disabled={!draft.trim() || recipientCount === 0}
              successLabel="Sent"
              accent="#9bcfbe"
              accentInk="#fff"
            />
          </Card>
          </SpotlightTarget>

          <Text style={styles.sentLabel}>Sent</Text>

          {loading && !items ? (
            <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
          ) : error ? (
            <Card>
              <Muted>{error}</Muted>
            </Card>
          ) : items && items.length > 0 ? (
            <View style={{ gap: 10 }}>
              {items.map((a, i) => (
                <Card key={a.id ?? i}>
                  <Text style={styles.body}>{a.body}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{timeAgo(a.createdAt)}</Text>
                    {typeof a.recipientCount === "number" ? (
                      <Text style={styles.meta}>- {a.recipientCount} recipients</Text>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <Card style={styles.emptyCard}>
              <Ionicons name="chatbox-outline" size={18} color={colors.inkMuted} />
              <Text style={styles.emptyTitle}>No announcements yet</Text>
              <Muted style={styles.emptyCopy}>Your team updates will appear here.</Muted>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12 },
  composeCard: { marginBottom: 20, gap: 10 },
  cardTitle: {
    color: colors.inkMuted,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  compose: {
    minHeight: 80,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: "top",
  },
  composeMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  helper: { color: colors.inkMuted, fontSize: 12 },
  sentLabel: {
    marginBottom: 8,
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  metaRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  meta: { fontSize: 12, color: colors.inkFaint },
  emptyCard: { minHeight: 140, alignItems: "center", justifyContent: "center" },
  emptyTitle: { marginTop: 8, fontSize: 15, fontWeight: "700", color: colors.ink },
  emptyCopy: { marginTop: 4, textAlign: "center" },
});
