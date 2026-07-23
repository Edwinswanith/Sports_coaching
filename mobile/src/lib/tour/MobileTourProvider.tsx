import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import type { Role } from "../roles";
import { ROLE_THEMES, colors, radius } from "../theme";
import { MOBILE_TOUR_STEPS, type MobileTourStep, type MobileTourStepContext } from "./steps";
import { speakTourStep, stopTourNarration } from "./tourNarration";

// Single switch for the guided tour's trigger behavior.
//   false (default) — shows once per new user, then stays dismissed.
//   true             — replays on every login (useful for testing/demos).
//
// On the deployed web build, this is read at CONTAINER STARTUP (not baked in
// at Docker build time) from window.__RUNTIME_CONFIG__, which
// docker/entrypoint.sh regenerates from the Cloud Run env var TOUR_ALWAYS_SHOW
// every time the container boots — so changing it in the Cloud Run console
// and deploying a new revision takes effect with no image rebuild. Local dev
// and native builds have no window/__RUNTIME_CONFIG__, so they fall back to
// the build-time EXPO_PUBLIC_TOUR_ALWAYS_SHOW from apps/mobile/.env.
function readTourAlwaysShow(): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const runtimeValue = (window as unknown as { __RUNTIME_CONFIG__?: Record<string, string> }).__RUNTIME_CONFIG__
      ?.TOUR_ALWAYS_SHOW;
    if (runtimeValue !== undefined) return runtimeValue === "true";
  }
  return process.env.EXPO_PUBLIC_TOUR_ALWAYS_SHOW === "true";
}
const TOUR_ALWAYS_SHOW = readTourAlwaysShow();

// Same-screen steps can still be waiting on that screen's own initial data
// fetch (not just an already-mounted target) — give this real headroom, not
// just enough time for a re-render. Cross-screen steps additionally wait on
// navigation + that screen's mount.
const SAME_SCREEN_TIMEOUT_MS = 5000;
const CROSS_SCREEN_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 100;

type TourState = {
  active: boolean;
  role: Role | null;
  steps: MobileTourStep[];
  index: number;
  /** True once the current step's target has confirmed it mounted on screen. */
  ready: boolean;
  note: string | null;
  noteLoading: boolean;
  audioEnabled: boolean;
  audioSpeaking: boolean;
};

export type TourHighlightStyle = ViewStyle;

type TourContextValue = {
  state: TourState;
  startTour: (role: Role) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  reportTargetMounted: (id: string) => void;
  reportTargetUnmounted: (id: string) => void;
  registerAction: (id: string, fn: () => void) => () => void;
};

const INITIAL_STATE: TourState = {
  active: false,
  role: null,
  steps: [],
  index: 0,
  ready: false,
  note: null,
  noteLoading: false,
  audioEnabled: false,
  audioSpeaking: false,
};

const TourContext = createContext<TourContextValue | null>(null);

function seenKey(userId: string, role: Role) {
  return `scp.mobile.tour.seen.${userId}.${role}`;
}

async function getStoredFlag(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStoredFlag(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, "1");
    return;
  }
  await SecureStore.setItemAsync(key, "1");
}

export function useMobileTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useMobileTour must be used within MobileTourProvider");
  return ctx;
}

/**
 * Marks a component as the on-screen target for a tour step, WITHOUT any
 * cross-layer position measurement. The component applies `highlightStyle`
 * to itself (a border/background, spread into its own style array) when
 * `isActive` is true — since the highlight is rendered as part of the
 * target's own normal layout, it can never be misaligned the way a
 * separately-measured overlay (Modal vs. status bar vs. absolutely
 * positioned elements — different coordinate spaces) can be.
 *
 * When the tour is running but this id is a *different* step (both are
 * simultaneously visible on the same screen, e.g. the header and the
 * readiness card), it self-dims instead — same reasoning: a component
 * dimming itself in the main tree can't wash out the active target the way
 * a Modal-level scrim (a separate native layer on Android) did.
 *
 * Still tells the provider "I'm mounted" so its poll/timeout/auto-skip logic
 * (owner-only steps, empty-state steps, etc.) keeps working.
 */
export function useTourHighlight(id: string | undefined | null): {
  isActive: boolean;
  highlightStyle: TourHighlightStyle | undefined;
} {
  const { state, reportTargetMounted, reportTargetUnmounted } = useMobileTour();

  useEffect(() => {
    if (!id) return;
    reportTargetMounted(id);
    return () => reportTargetUnmounted(id);
  }, [id, reportTargetMounted, reportTargetUnmounted]);

  const isActive = Boolean(id) && state.active && state.steps[state.index]?.id === id;
  const isOtherStep = Boolean(id) && state.active && !isActive && state.steps.some((step) => step.id === id);
  const theme = state.role ? ROLE_THEMES[state.role] : ROLE_THEMES.athlete;

  let highlightStyle: TourHighlightStyle | undefined;
  if (isActive) {
    highlightStyle = {
      borderWidth: 4,
      borderColor: theme.accent,
      borderRadius: 16,
      backgroundColor: theme.accentStrong + "33",
      shadowColor: theme.accent,
      shadowOpacity: 1,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 0 },
      elevation: 24,
    };
  } else if (isOtherStep) {
    // Gentle dim only — a heavier cut (e.g. 0.32) visually compounds with
    // cards' own existing thin borders and reads as a hard dark outline.
    highlightStyle = { opacity: 0.62 };
  }

  return { isActive, highlightStyle };
}

/** Registers a callback the tour can run right before it waits for a step's target on this screen. */
export function useTourAction(id: string, fn: () => void): void {
  const { registerAction } = useMobileTour();
  useEffect(() => registerAction(id, fn), [registerAction, id, fn]);
}

export function useAutoStartMobileTour(role: Role): void {
  const { status, user } = useAuth();
  const { startTour, state } = useMobileTour();
  const startedRef = useRef(false);

  useEffect(() => {
    if (status !== "authed" || !user?.id || user.role !== role || startedRef.current || state.active) return;
    startedRef.current = true;
    const key = seenKey(user.id, role);
    getStoredFlag(key)
      .then((seen) => {
        if (!seen || TOUR_ALWAYS_SHOW) startTour(role);
      })
      .catch(() => undefined);
  }, [role, startTour, state.active, status, user?.id, user?.role]);
}

export function MobileTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<TourState>(INITIAL_STATE);
  const mountedTargetsRef = useRef(new Set<string>());
  const actionsRef = useRef(new Map<string, () => void>());
  const noteCacheRef = useRef(new Map<string, string>());
  const runIdRef = useRef(0);
  const spokenStepRef = useRef<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const reportTargetMounted = useCallback((id: string) => {
    mountedTargetsRef.current.add(id);
  }, []);

  const reportTargetUnmounted = useCallback((id: string) => {
    mountedTargetsRef.current.delete(id);
  }, []);

  const registerAction = useCallback((id: string, fn: () => void) => {
    actionsRef.current.set(id, fn);
    return () => {
      if (actionsRef.current.get(id) === fn) actionsRef.current.delete(id);
    };
  }, []);

  const finish = useCallback(() => {
    void stopTourNarration();
    setState((prev) => {
      if (prev.role && user?.id) {
        setStoredFlag(seenKey(user.id, prev.role)).catch(() => undefined);
      }
      return INITIAL_STATE;
    });
  }, [user]);

  const advanceToRef = useRef<(steps: MobileTourStep[], index: number, myRun: number) => void>(() => undefined);
  const advanceTo = useCallback(
    (steps: MobileTourStep[], index: number, myRun: number) => {
      if (index >= steps.length) {
        finish();
        return;
      }
      const step = steps[index];
      const stepContext: MobileTourStepContext = { isAcademyOwner: user?.isAcademyOwner };
      if (step.skipIf && step.skipIf(stepContext)) {
        advanceToRef.current(steps, index + 1, myRun);
        return;
      }

      void stopTourNarration();
      spokenStepRef.current = null;
      setState((prev) => ({ ...prev, index, ready: false, note: null, noteLoading: false, audioSpeaking: false }));

      const cameFromNav = Boolean(step.route) && pathnameRef.current !== step.route;
      if (cameFromNav && step.route) {
        router.push(step.route as never);
      }

      const deadline = Date.now() + (cameFromNav ? CROSS_SCREEN_TIMEOUT_MS : SAME_SCREEN_TIMEOUT_MS);
      let actionRan = false;

      const poll = () => {
        if (runIdRef.current !== myRun) return; // superseded by a newer step/skip/finish
        if (mountedTargetsRef.current.has(step.id) && (actionRan || !step.action)) {
          setState((prev) => (prev.index === index ? { ...prev, ready: true } : prev));
          return;
        }
        if (!actionRan && step.action) {
          actionsRef.current.get(step.action)?.();
          actionRan = true;
        }
        if (Date.now() > deadline) {
          advanceToRef.current(steps, index + 1, myRun);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      };
      poll();
    },
    [finish, user?.isAcademyOwner]
  );
  useEffect(() => {
    advanceToRef.current = advanceTo;
  }, [advanceTo]);

  const startTour = useCallback(
    (role: Role) => {
      const steps = MOBILE_TOUR_STEPS[role];
      const myRun = ++runIdRef.current;
      setState({ ...INITIAL_STATE, active: true, role, steps });
      advanceTo(steps, 0, myRun);
    },
    [advanceTo]
  );

  const next = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, state.index + 1, myRun);
  }, [advanceTo, state.steps, state.index]);

  const back = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, Math.max(0, state.index - 1), myRun);
  }, [advanceTo, state.steps, state.index]);

  const skip = useCallback(() => {
    runIdRef.current++;
    void stopTourNarration();
    finish();
  }, [finish]);

  const speakCurrentStep = useCallback(
    async (enableAudio: boolean, force = false) => {
      const step = state.steps[state.index];
      const message = [step?.title, state.note ?? step?.fallbackNote].filter(Boolean).join(". ");
      if (!force && step?.id && spokenStepRef.current === step.id) return;
      if (!message.trim()) return;
      if (step?.id) spokenStepRef.current = step.id;
      setState((prev) => ({ ...prev, audioEnabled: enableAudio || prev.audioEnabled, audioSpeaking: true }));
      await speakTourStep(message).finally(() => {
        setState((prev) => ({ ...prev, audioSpeaking: false }));
      });
    },
    [state.index, state.note, state.steps]
  );

  const playAudio = useCallback(() => {
    void speakCurrentStep(true);
  }, [speakCurrentStep]);

  const pauseAudio = useCallback(() => {
    void stopTourNarration();
    setState((prev) => ({ ...prev, audioEnabled: false, audioSpeaking: false }));
  }, []);

  const replayAudio = useCallback(() => {
    void speakCurrentStep(true, true);
  }, [speakCurrentStep]);

  // Fetch the AI-agent narration once the current step's target has confirmed
  // it's mounted; shows the fallback note instantly and swaps in the live
  // text on arrival.
  useEffect(() => {
    if (!state.active || !state.ready) return;
    const step = state.steps[state.index];
    if (!step) return;

    const cached = noteCacheRef.current.get(step.id);
    if (cached) {
      setState((prev) => (prev.index === state.index ? { ...prev, note: cached, noteLoading: false } : prev));
      return;
    }

    let cancelled = false;
    setState((prev) => (prev.index === state.index ? { ...prev, note: step.fallbackNote, noteLoading: true } : prev));
    apiJson<{ note?: string }>("/api/tour/narrate", {
      method: "POST",
      body: JSON.stringify({
        stepId: step.id,
        title: step.title,
        fallbackNote: step.fallbackNote,
        context: { surface: "mobile" },
      }),
    })
      .then((result) => {
        if (cancelled) return;
        const note = typeof result.note === "string" && result.note.trim() ? result.note.trim() : step.fallbackNote;
        noteCacheRef.current.set(step.id, note);
        setState((prev) => (prev.index === state.index ? { ...prev, note, noteLoading: false } : prev));
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => (prev.index === state.index ? { ...prev, noteLoading: false } : prev));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.active, state.ready, state.index, state.steps]);

  useEffect(() => {
    if (!state.active || !state.ready || !state.audioEnabled || state.noteLoading) return;
    void speakCurrentStep(true);
  }, [speakCurrentStep, state.active, state.audioEnabled, state.index, state.noteLoading, state.ready]);

  useEffect(() => () => {
    void stopTourNarration();
  }, []);

  const currentStep = state.steps[state.index] ?? null;
  const isLast = state.index >= state.steps.length - 1;
  const theme = state.role ? ROLE_THEMES[state.role] : ROLE_THEMES.athlete;
  const cardAtTop = currentStep?.cardPosition === "top";

  const value = useMemo(
    () => ({ state, startTour, next, back, skip, reportTargetMounted, reportTargetUnmounted, registerAction }),
    [back, next, skip, startTour, state, reportTargetMounted, reportTargetUnmounted, registerAction]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <Modal visible={state.active} transparent animationType="fade" onRequestClose={skip}>
        {/* No screen-wide dim: on Android the Modal renders in its own native
            layer, always compositing above the real screen — so any dim here
            would wash out the highlighted target too (it's real content,
            drawn behind this Modal, not inside it). Instead the target
            itself carries a bright glowing border (see useTourHighlight),
            which stays fully lit since nothing darkens it. */}
        <View
          style={[
            cardAtTop ? styles.backdropWrapTop : styles.backdropWrapBottom,
            cardAtTop ? { paddingTop: 18 + insets.top } : { paddingBottom: 18 + insets.bottom },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.card}>
            <View style={styles.topRow}>
              <View style={[styles.agentMark, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="sparkles-outline" size={14} color={theme.accentStrong} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>{currentStep?.title ?? "Tour"}</Text>
                <Text style={styles.count}>Step {state.index + 1} of {state.steps.length}</Text>
              </View>
              <Pressable onPress={skip} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Skip tour">
                <Ionicons name="close" size={16} color={colors.inkMuted} />
              </Pressable>
            </View>

            <View style={styles.noteBox}>
              <Text style={styles.note} numberOfLines={4}>{state.note ?? currentStep?.fallbackNote ?? ""}</Text>
            </View>

            <View style={styles.audioRow}>
              <Pressable
                onPress={state.audioSpeaking ? pauseAudio : playAudio}
                style={[styles.audioPrimary, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]}
                accessibilityRole="button"
                accessibilityLabel={state.audioSpeaking ? "Pause tour audio" : "Play tour audio"}
              >
                <Ionicons name={state.audioSpeaking ? "pause" : "volume-high-outline"} size={15} color={theme.accentStrong} />
                <Text style={[styles.audioPrimaryText, { color: theme.accentStrong }]}>
                  {state.audioSpeaking ? "Pause" : state.audioEnabled ? "Audio on" : "Play audio"}
                </Text>
              </Pressable>
              <Pressable
                onPress={replayAudio}
                style={styles.audioIcon}
                accessibilityRole="button"
                accessibilityLabel="Replay tour audio"
              >
                <Ionicons name="refresh" size={15} color={colors.inkMuted} />
              </Pressable>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${state.steps.length ? ((state.index + 1) / state.steps.length) * 100 : 0}%`,
                    backgroundColor: theme.accent,
                  },
                ]}
              />
            </View>

            <View style={styles.actions}>
              <Pressable onPress={skip} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip tour">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
              <View style={styles.actionsRight}>
                <Pressable
                  onPress={back}
                  disabled={state.index === 0}
                  style={[styles.secondary, state.index === 0 ? styles.disabled : null]}
                >
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={isLast ? finish : next}
                  style={[styles.primary, { backgroundColor: theme.accent }]}
                >
                  <Text style={[styles.primaryText, { color: theme.accentInk }]}>{isLast ? "Done" : "Next"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </TourContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdropWrapBottom: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
  },
  backdropWrapTop: {
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 24,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentMark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  count: { marginTop: 1, color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  close: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
  },
  title: { fontSize: 14, fontWeight: "800", color: colors.ink },
  noteBox: {
    marginTop: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  note: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, fontWeight: "500" },
  audioRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  audioPrimary: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  audioPrimaryText: { fontSize: 12, fontWeight: "800" },
  audioIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  progressTrack: {
    marginTop: 10,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceInset,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  actions: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  skipText: { color: colors.inkFaint, fontSize: 12, fontWeight: "700" },
  actionsRight: { flexDirection: "row", gap: 8 },
  secondary: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  secondaryText: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  primary: { height: 36, paddingHorizontal: 18, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.45 },
});
