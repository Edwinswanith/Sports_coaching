import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ROLE_THEME_LIST, colors, radius } from "../lib/theme";
import { H1, Muted } from "../components/ui";

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: "flash", title: "Daily check-in & RPM", sub: "Log training load, sleep, soreness in seconds" },
  { icon: "speedometer-outline", title: "Readiness & risk flags", sub: "Green / amber / red, computed for you" },
  { icon: "chatbubble-ellipses-outline", title: "Coach feedback", sub: "Notes and guidance, right where you train" },
  { icon: "trending-up-outline", title: "Trends & history", sub: "Watch every number move over time" },
];

export default function Landing() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.mark}>
            <Ionicons name="ellipse-outline" size={20} color={colors.surface} />
          </View>
          <Text style={styles.brand}>APEX</Text>
        </View>

        <H1 style={{ marginTop: 24 }}>Train by the numbers.</H1>
        <Muted style={{ marginTop: 10, maxWidth: 300 }}>
          One performance OS. Choose how you are signing in.
        </Muted>

        <View style={{ marginTop: 28, gap: 12 }}>
          {ROLE_THEME_LIST.map((t) => (
            <Pressable
              key={t.role}
              onPress={() => router.push(`/login/${t.role}` as never)}
              style={({ pressed }) => [styles.roleCard, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.roleIcon, { backgroundColor: t.accentSoft }]}>
                <Ionicons name={`${t.icon}` as never} size={22} color={t.accentStrong} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleLabel}>{t.label}</Text>
                <Text style={styles.roleTag}>{t.tagline}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.inkFaint} />
            </Pressable>
          ))}
        </View>

        <Muted style={{ marginTop: 22, fontSize: 12 }}>
          Existing accounts keep their saved role. New Google users are created from the role they pick.
        </Muted>

        <View style={styles.featureSection}>
          <Text style={styles.sectionLabel}>What you get</Text>
          <View style={styles.featureCard}>
            {FEATURES.map((feature, index) => (
              <View
                key={feature.title}
                style={[styles.featureRow, index === FEATURES.length - 1 ? styles.featureRowLast : null]}
              >
                <View style={styles.featureIcon}>
                  <Ionicons name={feature.icon} size={18} color={colors.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureSub}>{feature.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 24, paddingTop: 32, flexGrow: 1 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: {
    height: 32,
    width: 32,
    borderRadius: 9,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 14, fontWeight: "700", letterSpacing: 4, color: colors.inkMuted },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  roleIcon: { height: 44, width: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel: { fontSize: 17, fontWeight: "700", color: colors.ink },
  roleTag: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  featureSection: { marginTop: 28 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  featureCard: {
    marginTop: 12,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  featureRowLast: { borderBottomWidth: 0 },
  featureIcon: {
    height: 36,
    width: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  featureSub: { fontSize: 12, color: colors.inkMuted, marginTop: 2, lineHeight: 16 },
});
