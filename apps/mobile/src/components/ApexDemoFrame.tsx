import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "./AppText";

type DemoTab = "today" | "progress" | "coach" | "lab";

const tabs: Array<{ key: DemoTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "today", label: "Today", icon: "home-outline" },
  { key: "progress", label: "Progress", icon: "pulse-outline" },
  { key: "coach", label: "Coach", icon: "people-outline" },
  { key: "lab", label: "Lab", icon: "flask-outline" },
];

export function ApexDemoFrame() {
  const [tab, setTab] = useState<DemoTab>("today");
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.logo}><Ionicons name="flash-outline" size={17} color="#fff" /></View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.brand}>Apex Assist</Text>
            <Text style={styles.demoPill}>Demo</Text>
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>Athlete reporting, without the admin work</Text>
        </View>
        <View style={styles.calendar}><Ionicons name="calendar-outline" size={16} color="#203029" /></View>
        <View style={styles.avatar}><Text style={styles.avatarText}>AS</Text></View>
      </View>

      <ScrollView key={tab} style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {tab === "today" ? <TodayScreen /> : null}
        {tab === "progress" ? <ProgressScreen /> : null}
        {tab === "coach" ? <CoachScreen /> : null}
        {tab === "lab" ? <LabScreen /> : null}
      </ScrollView>

      <AskAgent />
      <View style={styles.nav}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={styles.navItem}>
              <View style={[styles.navIcon, active ? styles.navIconActive : null]}>
                <Ionicons name={item.icon} size={17} color={active ? "#087052" : "#69756f"} />
              </View>
              <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.pageTitle}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.pageH1}>{title}</Text>
    </View>
  );
}

function TodayScreen() {
  return (
    <View style={styles.screen}>
      <PageTitle eyebrow="Athlete workspace" title="Today" />
      <TodayHero />
      <View style={styles.todayStack}>
        <Card eyebrow="Published by Coach Priya" title="Strongman conditioning · 2026-07-13" pill="Version 1" compact>
          <Text style={styles.mutedSmall}>Power endurance · 65 min · Draft revisions stay private until published.</Text>
          <View style={styles.exerciseStack}>
            <StackExercise compact name="Farmer's walk" detail="4 × 30 m · 24 kg per hand" rpe="7" rest="90s" />
            <StackExercise compact name="Tire flip" detail="5 × 6 reps · 80 kg" rpe="8" rest="120s" />
            <StackExercise compact name="Sled push" detail="6 × 20 m · 60 kg" rpe="7" rest="90s" />
          </View>
          <Text style={styles.linkSmall}>Ask about this plan →</Text>
        </Card>
        <Card eyebrow="Morning check-in" title="3 signals are missing" pill="1 of 4 logged" compact>
          <View style={styles.checkColumn}>
            <Signal compact label="Sleep quality" value="Missing" />
            <Signal compact label="Mood" value="7 / 10" ok />
            <Signal compact label="Soreness" value="Missing" />
            <Signal compact label="Fatigue" value="Missing" />
          </View>
        </Card>
        <Card eyebrow="Hydration" title="750 ml logged" pill="25% of goal" compact>
          <View style={styles.hydrationRow}>
            <View style={styles.waterBottle}>
              <View style={[styles.waterFill, { height: "25%" }]} />
              <View style={styles.waterIconWrap}>
                <Ionicons name="water-outline" size={16} color="#55a8d4" />
              </View>
            </View>
            <View style={styles.hydrationCopy}>
              <Text style={styles.hydrationTotal}>750 <Text style={styles.hydrationUnit}>ml</Text></Text>
              <Text style={styles.mutedTiny}>of 3,000 ml daily goal</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: "25%" }]} />
              </View>
              <Text style={styles.linkSmall}>+ Manual log</Text>
            </View>
          </View>
        </Card>
        <Card eyebrow="Training plan" title="2 sessions scheduled" pill="2 pending" compact>
          <View style={styles.checkColumn}>
            <TrainingSession compact slot="Morning · 7:00 AM" title="Conditioning" detail="Tempo runs · 40 min" pending />
            <TrainingSession compact slot="Evening · 5:30 PM" title="Strength" detail="Lower body · 4 × 8" pending />
          </View>
          <View style={styles.noteBox}>
            <Ionicons name="sparkles-outline" size={12} color="#d89500" />
            <Text style={styles.noteText}>Two sessions are incomplete, so “I completed training” should ask which session.</Text>
          </View>
        </Card>
        <MiniActionCard icon="heart-outline" eyebrow="Recovery" title="Not logged yet" cta="Log recovery →" />
        <MiniActionCard icon="chatbubble-outline" eyebrow="Coach Priya" title="Focus on clean form" detail="Keep Monday's strongman work controlled at the published loads." cta="Reply to coach →" />
      </View>
    </View>
  );
}

function ProgressScreen() {
  const [range, setRange] = useState<7 | 14 | 30>(30);
  return (
    <View style={styles.screen}>
      <PageTitle eyebrow="Performance analytics" title="30-day progress" />
      <ProgressHero range={range} onRange={setRange} />
      <View style={styles.metricGrid}>
        <MetricTile label="Average readiness" value="67.7" sub="/100" />
        <MetricTile label="Training completion" value="95" sub="%" />
        <MetricTile label="Hydration goal" value="27" sub="%" />
        <MetricTile label="Session load" value="17,093" sub="AU" />
      </View>
      <Card shrink eyebrow="Trend lines" title="Readiness and hydration consistency" pill={`${range} days`} compact>
        <FakeChart compact />
        <View style={styles.legendRow}>
          <Text style={styles.legendItem}>● Readiness</Text>
          <Text style={[styles.legendItem, { color: "#55a8d4" }]}>● Hydration</Text>
        </View>
      </Card>
      <View style={styles.progressBottom}>
        <Card small compact eyebrow="Performance benchmarks" title="First to latest test">
          <BenchmarkRow label="30 m sprint" value="4.32s → 4.21s" />
          <BenchmarkRow label="100 m sprint" value="11.82s → 11.61s" />
          <BenchmarkRow label="Vertical jump" value="52 cm → 56 cm" />
          <BenchmarkRow label="Farmer's walk" value="24 kg → 28 kg" />
        </Card>
        <View style={styles.progressRightCol}>
          <Card small compact eyebrow="Triggered priorities" title="Review thresholds">
            <View style={styles.priorityBox}>
              <View style={styles.priorityDot} />
              <Text style={styles.priorityText} numberOfLines={2}>Hydration goals were not met on 22 of 30 days.</Text>
            </View>
          </Card>
          <Card small compact flex eyebrow="Daily history" title="Open any day">
            <HistoryRow date="12 Jul" detail="Conditioning done" score="91" />
            <HistoryRow date="11 Jul" detail="Strength done" score="88" />
            <HistoryRow date="10 Jul" detail="Rest day" score="85" />
            <HistoryRow date="9 Jul" detail="Both sessions" score="82" />
          </Card>
        </View>
      </View>
    </View>
  );
}

function CoachScreen() {
  return (
    <View style={styles.screen}>
      <PageTitle eyebrow="Coach workspace" title="Workout planner" />
      <CoachHero />
      <View style={styles.flexStack}>
        <Card eyebrow="Athlete-visible · published" title="Strongman conditioning" pill="Version 2" compact>
          <Text style={styles.mutedSmall}>Monday, 13 July · Power endurance · 65 min</Text>
          <View style={styles.exerciseStack}>
            <StackExercise name="Farmer's walk" detail="4 × 30 m · 24 kg per hand" rpe="7" rest="90s" />
            <StackExercise name="Tire flip" detail="5 × 6 reps · 83 kg" rpe="8" rest="120s" />
            <StackExercise name="Sled push" detail="6 × 20 m · 60 kg" rpe="7" rest="90s" />
          </View>
        </Card>
        <View style={styles.stepRow}>
          <StepCompact number="01" title="Coach authors" />
          <StepCompact number="02" title="Athlete reviews" />
          <StepCompact number="03" title="Assistant explains" />
        </View>
      </View>
    </View>
  );
}

function LabScreen() {
  return (
    <View style={styles.screen}>
      <PageTitle eyebrow="Test laboratory" title="Action trace" />
      <LabHero />
      <View style={styles.flexStack}>
        <Card eyebrow="Request pipeline" title="Six observable checkpoints" pill="Gemini connected" compact>
          <Pipeline />
        </Card>
        <Card flex eyebrow="Latest trace" title="Completed" pill="Waiting" compact>
          <TraceGrid />
        </Card>
        <ProviderStrip />
      </View>
    </View>
  );
}

function TodayHero() {
  return (
    <LinearGradient colors={["#15382e", "#1a4638"]} style={styles.todayHero}>
      <View style={styles.heroDecor} />
      <View style={styles.heroInner}>
        <View style={styles.greetingRow}>
          <Ionicons name="sunny-outline" size={13} color="#91dabc" />
          <Text style={styles.greetingInHero}>Good morning, Aarav</Text>
        </View>
        <Text style={styles.heroTitleToday} numberOfLines={2}>Finish today's reporting in under a minute.</Text>
        <Text style={styles.heroMetaSmall} numberOfLines={1}>You have 4 items left. Speak naturally or use the assistant.</Text>
        <View style={styles.progressStrip}>
          <View style={styles.progressRingSmall}>
            <Text style={styles.progressTextSmall}>1/5</Text>
            <Text style={styles.doneSmall}>Done</Text>
          </View>
          <View style={styles.progressCopy}>
            <Text style={styles.progressLabel}>Daily progress</Text>
            <Text style={styles.progressTime}>Updated 8:20 AM</Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}

function ProgressHero({ range, onRange }: { range: 7 | 14 | 30; onRange: (r: 7 | 14 | 30) => void }) {
  return (
    <LinearGradient colors={["#15382e", "#1a4638"]} style={styles.progressHero}>
      <View style={styles.heroDecor} />
      <Text style={styles.heroEyebrow}>Evidence, not guesswork</Text>
      <Text style={styles.heroTitleProgress} numberOfLines={1}>Aarav is trending forward.</Text>
      <Text style={styles.heroMetaSmall} numberOfLines={1}>13 Jun to 12 Jul 2026 · readiness, completion, hydration, load.</Text>
      <View style={styles.segmentRow}>
        {([7, 14, 30] as const).map((days) => (
          <Pressable key={days} onPress={() => onRange(days)} style={[styles.segmentBtn, range === days ? styles.segmentBtnActive : null]}>
            <Text style={[styles.segmentText, range === days ? styles.segmentTextActive : null]}>{days} days</Text>
          </Pressable>
        ))}
      </View>
    </LinearGradient>
  );
}

function CoachHero() {
  return (
    <LinearGradient colors={["#173e34", "#1a4638"]} style={styles.coachHero}>
      <Text style={styles.heroEyebrow}>Coach Priya · plan authority</Text>
      <Text style={styles.heroTitleCoach}>Draft privately. Publish deliberately.</Text>
      <Text style={styles.heroMetaSmall} numberOfLines={2}>Aarav sees only the latest published version. Exercise volume and intensity remain coach-authored.</Text>
      <Text style={styles.heroPrimaryCoach}>Create revision</Text>
    </LinearGradient>
  );
}

function LabHero() {
  return (
    <View style={styles.labHero}>
      <Text style={styles.heroEyebrowDark}>Diagnostic workspace</Text>
      <Text style={styles.heroTitleLab} numberOfLines={2}>See exactly where an assistant request succeeds or fails.</Text>
    </View>
  );
}

function Card({
  eyebrow,
  title,
  pill,
  small,
  compact,
  flex,
  shrink,
  children,
}: {
  eyebrow: string;
  title: string;
  pill?: string;
  small?: boolean;
  compact?: boolean;
  flex?: boolean;
  shrink?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.card, small ? styles.cardSmall : null, compact ? styles.cardCompact : null, flex ? styles.cardFlex : null, shrink ? styles.cardShrink : null]}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardEyebrow, { flex: 1 }]} numberOfLines={1}>{eyebrow}</Text>
        {pill ? <Text style={styles.pill}>{pill}</Text> : null}
      </View>
      <Text style={[styles.cardTitle, compact ? styles.cardTitleCompact : null]} numberOfLines={1}>{title}</Text>
      {children}
    </View>
  );
}

function StackExercise({ name, detail, rpe, rest, compact }: { name: string; detail: string; rpe: string; rest: string; compact?: boolean }) {
  return (
    <View style={[styles.stackExercise, compact ? styles.stackExerciseCompact : null]}>
      <Text style={[styles.exerciseName, compact ? styles.exerciseNameCompact : null]}>{name}</Text>
      <Text style={styles.mutedTiny}>{detail}</Text>
      <Text style={styles.tinyOk}>Target RPE {rpe} · Rest {rest}</Text>
    </View>
  );
}

function Signal({ label, value, ok, compact }: { label: string; value: string; ok?: boolean; compact?: boolean }) {
  return (
    <View style={[styles.signal, compact ? styles.signalCompact : null]}>
      <View style={styles.signalTop}><Text style={styles.signalLabel}>{label}</Text><View style={[styles.dot, ok ? styles.dotOk : null]} /></View>
      <Text style={[styles.signalValue, compact ? styles.signalValueCompact : null]}>{value}</Text>
    </View>
  );
}

function TrainingSession({ slot, title, detail, pending, compact }: { slot: string; title: string; detail: string; pending?: boolean; compact?: boolean }) {
  return (
    <View style={[styles.sessionCard, compact ? styles.sessionCardCompact : null]}>
      <View style={styles.sessionTop}>
        <View style={styles.sessionIcon}><Ionicons name="barbell-outline" size={14} color="#0f7656" /></View>
        {pending ? <Text style={styles.pendingPill}>Pending</Text> : null}
      </View>
      <Text style={styles.sessionSlot}>{slot}</Text>
      <Text style={styles.sessionTitle}>{title}</Text>
      <Text style={styles.mutedTiny}>{detail}</Text>
    </View>
  );
}

function MiniActionCard({ icon, eyebrow, title, detail, cta }: { icon: keyof typeof Ionicons.glyphMap; eyebrow: string; title: string; detail?: string; cta: string }) {
  return (
    <View style={styles.miniCard}>
      <View style={styles.miniIcon}><Ionicons name={icon} size={14} color="#087052" /></View>
      <Text style={styles.miniEyebrow}>{eyebrow}</Text>
      <Text style={styles.miniTitle}>{title}</Text>
      {detail ? <Text style={styles.mutedTiny}>{detail}</Text> : null}
      <Text style={styles.linkSmall}>{cta}</Text>
    </View>
  );
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.metricValue}>{value}<Text style={styles.unit}> {sub}</Text></Text>
    </View>
  );
}

function BenchmarkRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.benchmarkRow}>
      <Text style={styles.benchmarkLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.benchmarkValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.tinyOk}>Improving</Text>
    </View>
  );
}

function HistoryRow({ date, detail, score }: { date: string; detail: string; score: string }) {
  return (
    <View style={styles.historyRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.historyDate}>{date}</Text>
        <Text style={styles.mutedTiny} numberOfLines={1}>{detail}</Text>
      </View>
      <Text style={styles.historyScore}>{score}</Text>
    </View>
  );
}

function FakeChart({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.chartWrap, compact ? styles.chartWrapCompact : null]}>
      <View style={styles.chart}>
        {[22, 30, 38, 28, 42, 36, 48, 44, 53, 49, 58, 52, 61, 54].map((h, i) => (
          <View key={i} style={[styles.bar, { height: `${Math.max(18, h)}%` }, i % 3 === 0 ? styles.barAlt : null]} />
        ))}
      </View>
    </View>
  );
}

function StepCompact({ number, title }: { number: string; title: string }) {
  return (
    <View style={styles.stepCompact}>
      <Text style={styles.stepNo}>{number}</Text>
      <Text style={styles.stepTitle} numberOfLines={2}>{title}</Text>
    </View>
  );
}

function Pipeline() {
  const steps = ["01", "02", "03", "04", "05", "06"];
  return (
    <View style={styles.pipeline}>
      {steps.map((x) => (
        <View key={x} style={styles.pipeItem}>
          <Text style={styles.pipeNo}>{x}</Text>
          <Ionicons name="checkmark-circle" size={16} color="#087052" />
        </View>
      ))}
    </View>
  );
}

function TraceGrid() {
  const fields = ["Text command", "Candidate tool", "Date range", "Metric", "Evidence", "Provider"];
  return (
    <View style={styles.traceGrid}>
      {fields.map((x) => (
        <View key={x} style={styles.traceCell}>
          <Text style={styles.traceLabel}>{x}</Text>
          <Text style={styles.mono}>-</Text>
        </View>
      ))}
    </View>
  );
}

function ProviderStrip() {
  return (
    <View style={styles.providerStrip}>
      {["Deepgram", "Gemini", "Local store"].map((x) => (
        <View key={x} style={styles.providerItem}>
          <Text style={styles.providerName}>{x}</Text>
          <Text style={styles.tinyOk}>Active</Text>
        </View>
      ))}
    </View>
  );
}

function AskAgent() {
  return (
    <Pressable style={styles.ask} accessibilityLabel="Ask agent">
      <Ionicons name="mic-outline" size={22} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f3f6f2" },
  header: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: "#dde4df",
    backgroundColor: "rgba(255,255,255,0.96)",
  },
  logo: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#06130f", alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  brand: { fontSize: 16, fontWeight: "900", color: "#101b17" },
  demoPill: { borderRadius: 999, backgroundColor: "#e4f1eb", paddingHorizontal: 7, paddingVertical: 2, color: "#087052", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  subtitle: { marginTop: 1, fontSize: 10, color: "#69756f" },
  calendar: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: "#dde4df", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#ffda9c", alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "900", fontSize: 11, color: "#3d2a15" },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 100, gap: 6 },
  screen: { gap: 6 },
  flexStack: { gap: 6 },
  todayStack: { gap: 6 },
  pageTitle: { flexShrink: 0, marginBottom: 0 },
  eyebrow: { fontSize: 8, fontWeight: "900", color: "#087052", textTransform: "uppercase", letterSpacing: 1.8 },
  pageH1: { marginTop: 0, fontSize: 20, lineHeight: 22, fontWeight: "900", color: "#101b17" },
  todayHero: { borderRadius: 18, overflow: "hidden", flexShrink: 0 },
  progressHero: { borderRadius: 18, padding: 10, overflow: "hidden", flexShrink: 0 },
  coachHero: { borderRadius: 22, padding: 12, overflow: "hidden", flexShrink: 0 },
  labHero: { borderRadius: 18, padding: 10, backgroundColor: "#111b18", flexShrink: 0 },
  heroDecor: { position: "absolute", right: -40, top: -40, width: 120, height: 120, borderRadius: 60, borderWidth: 28, borderColor: "rgba(255,255,255,0.04)" },
  heroInner: { padding: 10 },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  greetingInHero: { color: "#91dabc", fontSize: 10, fontWeight: "700" },
  heroEyebrow: { color: "#8ad8b7", fontSize: 8, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  heroEyebrowDark: { color: "#78d8b0", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  heroTitleToday: { color: "#fff", fontSize: 16, lineHeight: 19, fontWeight: "900" },
  heroTitleProgress: { color: "#fff", fontSize: 15, lineHeight: 18, fontWeight: "900", marginTop: 2 },
  heroTitleCoach: { color: "#fff", fontSize: 17, lineHeight: 20, fontWeight: "900", marginTop: 4 },
  heroTitleLab: { color: "#fff", fontSize: 14, lineHeight: 17, fontWeight: "900", marginTop: 4 },
  heroMetaSmall: { marginTop: 3, color: "rgba(255,255,255,0.62)", fontSize: 9, lineHeight: 12 },
  heroPrimaryCoach: { marginTop: 8, alignSelf: "flex-start", borderRadius: 11, backgroundColor: "#fff", color: "#173e34", paddingHorizontal: 14, paddingVertical: 9, fontWeight: "900", fontSize: 11, overflow: "hidden" },
  progressStrip: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.06)", padding: 8 },
  progressRingSmall: { width: 44, height: 44, borderRadius: 22, borderWidth: 4, borderColor: "#75e3b8", alignItems: "center", justifyContent: "center" },
  progressTextSmall: { color: "#fff", fontSize: 12, fontWeight: "900" },
  doneSmall: { color: "rgba(255,255,255,0.55)", fontSize: 7, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  progressCopy: { flex: 1 },
  progressLabel: { color: "#fff", fontSize: 11, fontWeight: "800" },
  progressTime: { marginTop: 1, color: "rgba(255,255,255,0.5)", fontSize: 9 },
  segmentRow: { marginTop: 6, flexDirection: "row", gap: 3, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.06)", padding: 2 },
  segmentBtn: { flex: 1, borderRadius: 7, paddingVertical: 5, alignItems: "center" },
  segmentBtnActive: { backgroundColor: "#fff" },
  segmentText: { color: "rgba(255,255,255,0.6)", fontSize: 9, fontWeight: "800" },
  segmentTextActive: { color: "#15382e" },
  card: { borderRadius: 16, borderWidth: 1, borderColor: "#dce4df", backgroundColor: "#fff", padding: 8, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  cardSmall: { flex: 1, minWidth: 0 },
  cardCompact: { paddingVertical: 6, paddingHorizontal: 8 },
  cardFlex: { flex: 1, minHeight: 0 },
  cardShrink: { flexShrink: 0 },
  cardTop: { flexDirection: "row", gap: 6, alignItems: "center" },
  cardEyebrow: { color: "#087052", fontSize: 7, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  cardTitle: { marginTop: 2, color: "#101b17", fontSize: 12, lineHeight: 15, fontWeight: "900" },
  cardTitleCompact: { fontSize: 11, lineHeight: 14 },
  pill: { borderRadius: 999, backgroundColor: "#eef2ed", color: "#69756f", paddingHorizontal: 6, paddingVertical: 2, fontSize: 7, fontWeight: "900", textTransform: "uppercase" },
  mutedSmall: { marginTop: 2, color: "#69756f", fontSize: 9, lineHeight: 12 },
  mutedTiny: { marginTop: 1, color: "#69756f", fontSize: 8, lineHeight: 11 },
  linkSmall: { marginTop: 4, color: "#087052", fontSize: 9, fontWeight: "900" },
  exerciseStack: { marginTop: 8, gap: 6 },
  stackExercise: { borderWidth: 1, borderColor: "#dce4df", borderRadius: 10, padding: 8, backgroundColor: "#fafbf9" },
  stackExerciseCompact: { padding: 6, borderRadius: 9 },
  exerciseName: { color: "#101b17", fontWeight: "900", fontSize: 11 },
  exerciseNameCompact: { fontSize: 10 },
  tinyOk: { marginTop: 2, color: "#087052", fontSize: 7, fontWeight: "900", textTransform: "uppercase" },
  checkColumn: { gap: 6, marginTop: 6 },
  signal: { borderWidth: 1, borderStyle: "dashed", borderColor: "#d5ddd8", borderRadius: 11, padding: 10 },
  signalCompact: { padding: 8, borderRadius: 10 },
  signalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  signalLabel: { color: "#69756f", fontSize: 8 },
  signalValue: { marginTop: 6, color: "#101b17", fontSize: 13, fontWeight: "900" },
  signalValueCompact: { marginTop: 4, fontSize: 11 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#d89500" },
  dotOk: { backgroundColor: "#15934f" },
  hydrationRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  waterBottle: { width: 52, height: 72, borderRadius: 16, borderWidth: 3, borderColor: "#dce8e2", backgroundColor: "#f6faf8", overflow: "hidden", justifyContent: "flex-end" },
  waterFill: { backgroundColor: "#9adcf4", width: "100%" },
  waterIconWrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  hydrationCopy: { flex: 1, minWidth: 0 },
  hydrationTotal: { color: "#101b17", fontSize: 22, fontWeight: "900" },
  hydrationUnit: { color: "#69756f", fontSize: 12, fontWeight: "800" },
  progressTrack: { marginTop: 6, height: 6, borderRadius: 999, backgroundColor: "#eef2ed", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#55b9de" },
  sessionCard: { borderWidth: 1, borderColor: "#dce4df", borderRadius: 10, padding: 8, backgroundColor: "#fafbf9" },
  sessionCardCompact: { padding: 7, borderRadius: 9 },
  sessionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#e4f1eb", alignItems: "center", justifyContent: "center" },
  pendingPill: { borderRadius: 999, backgroundColor: "#fff4df", color: "#b07a00", paddingHorizontal: 7, paddingVertical: 2, fontSize: 7, fontWeight: "900", textTransform: "uppercase", overflow: "hidden" },
  sessionSlot: { marginTop: 6, color: "#69756f", fontSize: 8, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  sessionTitle: { marginTop: 2, color: "#101b17", fontSize: 12, fontWeight: "900" },
  noteBox: { marginTop: 8, flexDirection: "row", gap: 6, borderRadius: 10, borderWidth: 1, borderColor: "#f0d9a8", backgroundColor: "#fff9ed", padding: 8 },
  noteText: { flex: 1, color: "#69756f", fontSize: 9, lineHeight: 12 },
  miniCard: { borderRadius: 16, borderWidth: 1, borderColor: "#dce4df", backgroundColor: "#fff", padding: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  miniIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#e4f1eb", alignItems: "center", justifyContent: "center" },
  miniEyebrow: { marginTop: 6, color: "#69756f", fontSize: 7, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  miniTitle: { marginTop: 2, color: "#101b17", fontSize: 12, fontWeight: "900" },
  outlineButtonSmall: { flex: 1, textAlign: "center", borderWidth: 1, borderColor: "#0d765780", borderRadius: 9, paddingVertical: 6, color: "#087052", fontWeight: "900", fontSize: 9, overflow: "hidden" },
  twoCol: { flexDirection: "row", gap: 5, flexShrink: 0 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, flexShrink: 0 },
  metricTile: { width: "48.5%", borderWidth: 1, borderColor: "#dce4df", borderRadius: 12, backgroundColor: "#fff", paddingHorizontal: 8, paddingVertical: 6 },
  metricLabel: { color: "#69756f", fontSize: 7, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  metricValue: { marginTop: 1, color: "#101b17", fontSize: 15, fontWeight: "900" },
  unit: { fontSize: 10, color: "#69756f", fontWeight: "800" },
  chartWrap: { minHeight: 52, marginTop: 4 },
  chartWrapCompact: { minHeight: 48 },
  chart: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 3, borderBottomWidth: 1, borderColor: "#ccd6d0", paddingBottom: 2, minHeight: 48 },
  bar: { flex: 1, borderRadius: 5, backgroundColor: "#0f7656", minHeight: 6 },
  barAlt: { backgroundColor: "#55a8d4" },
  progressBottom: { flex: 1, minHeight: 0, flexDirection: "row", gap: 4 },
  progressRightCol: { flex: 1, minWidth: 0, gap: 4 },
  benchmarkRow: { marginTop: 3, borderWidth: 1, borderColor: "#e8eeea", borderRadius: 8, padding: 5, backgroundColor: "#fafbf9" },
  benchmarkLabel: { color: "#69756f", fontSize: 8, fontWeight: "700" },
  benchmarkValue: { marginTop: 1, color: "#101b17", fontSize: 9, fontWeight: "900" },
  priorityBox: { marginTop: 4, flexDirection: "row", gap: 5, borderRadius: 8, borderWidth: 1, borderColor: "#f0d9a8", backgroundColor: "#fff9ed", padding: 6 },
  priorityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#d89500", marginTop: 3 },
  priorityText: { flex: 1, color: "#69756f", fontSize: 8, lineHeight: 11 },
  historyRow: { marginTop: 3, flexDirection: "row", alignItems: "center", gap: 4, borderBottomWidth: 1, borderColor: "#eef2ef", paddingBottom: 3 },
  historyDate: { color: "#101b17", fontSize: 9, fontWeight: "900" },
  historyScore: { color: "#087052", fontSize: 10, fontWeight: "900" },
  legendRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  legendItem: { fontSize: 9, fontWeight: "700", color: "#0f7656" },
  stepRow: { flexDirection: "row", gap: 5, flexShrink: 0 },
  stepCompact: { flex: 1, borderWidth: 1, borderColor: "#dce4df", borderRadius: 14, backgroundColor: "#fff", padding: 8, alignItems: "center" },
  stepNo: { color: "#087052", fontSize: 11, fontWeight: "900" },
  stepTitle: { marginTop: 3, color: "#101b17", fontSize: 9, fontWeight: "800", textAlign: "center" },
  pipeline: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  pipeItem: { alignItems: "center", gap: 2 },
  pipeNo: { color: "#69756f", fontSize: 8, fontWeight: "900" },
  traceGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  traceCell: { width: "33.33%", borderWidth: 1, borderColor: "#e4e9e6", padding: 6 },
  traceLabel: { color: "#69756f", fontSize: 7, fontWeight: "900", textTransform: "uppercase" },
  mono: { marginTop: 3, fontFamily: "monospace", fontSize: 9, color: "#101b17" },
  providerStrip: { flexDirection: "row", gap: 5, flexShrink: 0 },
  providerItem: { flex: 1, borderWidth: 1, borderColor: "#dce4df", borderRadius: 12, backgroundColor: "#fff", padding: 8, alignItems: "center" },
  providerName: { fontSize: 10, fontWeight: "900", color: "#101b17" },
  ask: { position: "absolute", right: 14, bottom: 72, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#06130f", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  nav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderTopWidth: 1, borderColor: "#dde4df", backgroundColor: "rgba(255,255,255,0.97)", paddingBottom: 4 },
  navItem: { flex: 1, alignItems: "center", gap: 1 },
  navIcon: { height: 26, minWidth: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  navIconActive: { backgroundColor: "#dff1eb" },
  navLabel: { fontSize: 9, fontWeight: "900", textTransform: "uppercase", color: "#69756f", letterSpacing: 0.5 },
  navLabelActive: { color: "#087052" },
});
