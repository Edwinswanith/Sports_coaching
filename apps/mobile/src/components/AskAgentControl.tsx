import { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { useTourHighlight } from "../lib/tour/MobileTourProvider";
import { startVoiceSession } from "../lib/voiceSession";

export function AskAgentControl({
  accent = "#ffad45",
  accentInk = "#1a0c00",
  onCommand,
  tourTargetId,
  onInputOpenChange,
  onListeningChange,
}: {
  accent?: string;
  accentInk?: string;
  onCommand: (text: string) => Promise<void> | void;
  /** Anchor id for the guided app tour (see lib/tour/steps.ts) — spotlighted when this step is active. */
  tourTargetId?: string;
  onInputOpenChange?: (open: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
}) {
  const { highlightStyle } = useTourHighlight(tourTargetId);
  const [inputOpen, setInputOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef(false);
  // Synchronous (unlike listening/busy state, which only updates on the next
  // render) guards against starting a second overlapping recognition session
  // or double-submitting one typed command — see the same fix in the
  // athlete dashboard's Ask Agent for the full rationale.
  const voiceActiveRef = useRef(false);
  const submitLockRef = useRef(false);
  // Driven by real mic input level (see lib/voiceSession) — powers the glow
  // that pulses around the FAB while the user is actually speaking.
  const glow = useSharedValue(0);

  async function submit(text: string) {
    const command = text.trim();
    if (!command || submitLockRef.current) return;
    submitLockRef.current = true;
    setBusy(true);
    setDraft("");
    setInputOpen(false);
    onInputOpenChange?.(false);
    try {
      await onCommand(command);
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  }

  function startVoice() {
    setInputOpen(false);
    onInputOpenChange?.(false);
    startVoiceSession({
      onListeningChange: (value) => {
        setListening(value);
        onListeningChange?.(value);
        if (!value) voiceActiveRef.current = false;
      },
      onVolume: (level) => {
        glow.value = withTiming(level, { duration: 80 });
      },
      onResult: (text) => void submit(text),
      onError: () => {
        voiceActiveRef.current = false;
      },
      onNeedsFallback: () => {
        voiceActiveRef.current = false;
        setInputOpen(true);
        onInputOpenChange?.(true);
      },
    });
  }

  function openInput() {
    longPressRef.current = true;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setInputOpen(true);
    onInputOpenChange?.(true);
  }

  function pressIn() {
    longPressRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(openInput, 2000);
  }

  function pressOut() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }

  function press() {
    if (voiceActiveRef.current || busy) return;
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    voiceActiveRef.current = true;
    startVoice();
  }

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.7 }],
    opacity: glow.value * 0.55,
  }));

  return (
    <>
      {!inputOpen ? (
        <>
          {listening ? (
            <Animated.View pointerEvents="none" style={[styles.glow, { backgroundColor: accent }, glowStyle]} />
          ) : null}
          <Pressable
            onPress={press}
            onPressIn={pressIn}
            onPressOut={pressOut}
            onLongPress={openInput}
            delayLongPress={2000}
            disabled={busy || listening}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: accent },
              listening ? styles.fabActive : null,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
              highlightStyle ? [highlightStyle, { borderRadius: 28 }] : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Ask agent"
            {...(Platform.OS === "web" ? ({ onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.() } as any) : {})}
          >
            <Ionicons name="sparkles-outline" size={22} color={listening ? accent : accentInk} />
          </Pressable>
        </>
      ) : null}
      {inputOpen ? (
        <View style={styles.inputOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setInputOpen(false);
              onInputOpenChange?.(false);
            }}
          />
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            editable={!busy}
            placeholder="Ask agent"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => submit(draft)}
            onBlur={() => submit(draft)}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === "Enter") void submit(draft);
            }}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 2000,
    elevation: 40,
    height: 56,
    width: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  fabActive: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  glow: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 1999,
    elevation: 39,
    height: 56,
    width: 56,
    borderRadius: 28,
  },
  inputOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 950,
    elevation: 30,
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingBottom: 92,
  },
  input: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 20,
    color: colors.ink,
    fontSize: 15,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
});
