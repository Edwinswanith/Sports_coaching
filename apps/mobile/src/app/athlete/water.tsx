import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Card, Muted } from "../../components/ui";

const today = () => new Date().toISOString().slice(0, 10);
const accent = ROLE_THEMES.athlete.accentStrong;

type Entry = { id: string; amountMl: number; loggedAt: string };
type WaterDay = { date: string; goalMl: number; totalMl: number; entries: Entry[] };

const QUICK = [250, 500, 750];

export default function Water() {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDay(await apiJson<WaterDay>(`/api/athlete/water?date=${today()}`));
    } catch {
      // leave previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(amountMl: number) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ amountMl, date: today() }),
      });
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" });
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const pct = day && day.goalMl > 0 ? Math.min(1, day.totalMl / day.goalMl) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Water</Text>
        <Muted style={{ marginBottom: 16 }}>Stay on top of hydration.</Muted>

        {loading && !day ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : day ? (
          <>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
                <Text style={[styles.total, { color: accent }]}>{(day.totalMl / 1000).toFixed(2)}</Text>
                <Text style={styles.unit}>/ {(day.goalMl / 1000).toFixed(1)} L</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: accent }]} />
              </View>
              <Muted style={{ marginTop: 8, fontSize: 12 }}>{Math.round(pct * 100)}% of today’s goal</Muted>
            </Card>

            <View style={styles.quickRow}>
              {QUICK.map((q) => (
                <Pressable
                  key={q}
                  disabled={busy}
                  onPress={() => add(q)}
                  style={({ pressed }) => [styles.quick, { opacity: busy ? 0.5 : pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="water" size={18} color={accent} />
                  <Text style={styles.quickText}>+{q} ml</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Today’s entries</Text>
            {day.entries.length === 0 ? (
              <Muted>Nothing logged yet — tap a button above.</Muted>
            ) : (
              <View style={{ gap: 8 }}>
                {[...day.entries].reverse().map((e) => (
                  <Card key={e.id} style={styles.entryRow}>
                    <Text style={styles.entryAmt}>{e.amountMl} ml</Text>
                    <Text style={styles.entryTime}>
                      {new Date(e.loggedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                    <Pressable onPress={() => remove(e.id)} disabled={busy} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.inkFaint} />
                    </Pressable>
                  </Card>
                ))}
              </View>
            )}
          </>
        ) : (
          <Card>
            <Muted>Couldn’t load hydration.</Muted>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  total: { fontSize: 44, fontWeight: "800" },
  unit: { fontSize: 16, fontWeight: "600", color: colors.inkMuted, marginBottom: 8 },
  track: { height: 10, borderRadius: 999, backgroundColor: colors.surfaceInset, marginTop: 12, overflow: "hidden" },
  fill: { height: 10, borderRadius: 999 },
  quickRow: { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 20 },
  quick: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  quickText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  entryRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  entryAmt: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  entryTime: { fontSize: 13, color: colors.inkMuted },
});
