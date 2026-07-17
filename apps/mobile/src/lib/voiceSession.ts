import { Platform } from "react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

export type VoiceSessionHandlers = {
  onListeningChange: (listening: boolean) => void;
  /** Normalized 0..1 input level, sampled every ~80-100ms while listening; 0 when silent/not listening. */
  onVolume: (level: number) => void;
  onResult: (transcript: string) => void;
  onError: () => void;
  /** Permission denied, unsupported browser, or no window (SSR) — caller should fall back to the text input. */
  onNeedsFallback: () => void;
};

/**
 * Starts one voice-command session (web SpeechRecognition + Web Audio API
 * metering, or native ExpoSpeechRecognitionModule + its volumechange event)
 * and reports transcript + live input level. Centralizes the session-hygiene
 * fixes both callers previously duplicated: a session naturally ends after
 * one final result (guarded against a platform double-firing onresult), and
 * a 20s safety net in case a recognizer never fires end/error.
 */
export function startVoiceSession(handlers: VoiceSessionHandlers): void {
  if (Platform.OS === "web") {
    startWebVoiceSession(handlers);
  } else {
    startNativeVoiceSession(handlers);
  }
}

function startWebVoiceSession(handlers: VoiceSessionHandlers): void {
  if (typeof window === "undefined") {
    handlers.onNeedsFallback();
    return;
  }
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onNeedsFallback();
    return;
  }

  const recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  let resultHandled = false;
  let ended = false;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let rafId: number | null = null;

  function stopMetering() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audioCtx && audioCtx.state !== "closed") audioCtx.close().catch(() => undefined);
    audioCtx = null;
    handlers.onVolume(0);
  }

  // Volume metering is a separate, best-effort audio stream — the Web Speech
  // API itself has no volume/level API. If the mic stream can't be opened
  // (denied, unsupported), voice commands still work; the glow just stays
  // off.
  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((s) => {
      if (ended) {
        s.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = s;
      const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(s);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        handlers.onVolume(Math.max(0, Math.min(1, rms * 4)));
        rafId = requestAnimationFrame(tick);
      };
      tick();
    })
    .catch(() => undefined);

  recognition.onstart = () => handlers.onListeningChange(true);
  recognition.onerror = () => {
    ended = true;
    stopMetering();
    handlers.onListeningChange(false);
    handlers.onError();
  };
  recognition.onend = () => {
    ended = true;
    stopMetering();
    handlers.onListeningChange(false);
  };
  recognition.onresult = (event: any) => {
    if (resultHandled) return;
    resultHandled = true;
    const text = Array.from(event.results ?? [])
      .map((result: any) => result?.[0]?.transcript ?? "")
      .join(" ")
      .trim();
    handlers.onResult(text);
    try {
      recognition.stop();
    } catch {
      // already ended — nothing to do
    }
  };
  recognition.start();
  setTimeout(() => {
    try {
      recognition.stop();
    } catch {
      // already ended — nothing to do
    }
  }, 20000);
}

function startNativeVoiceSession(handlers: VoiceSessionHandlers): void {
  ExpoSpeechRecognitionModule.requestPermissionsAsync().then((permission) => {
    if (!permission.granted) {
      handlers.onNeedsFallback();
      return;
    }

    let resultHandled = false;
    const subscriptions: { remove: () => void }[] = [];
    function cleanup() {
      subscriptions.forEach((sub) => sub.remove());
    }

    subscriptions.push(ExpoSpeechRecognitionModule.addListener("start", () => handlers.onListeningChange(true)));
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("end", () => {
        cleanup();
        handlers.onListeningChange(false);
        handlers.onVolume(0);
      })
    );
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("error", () => {
        cleanup();
        handlers.onListeningChange(false);
        handlers.onVolume(0);
        handlers.onError();
      })
    );
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("result", (event) => {
        if (resultHandled) return;
        resultHandled = true;
        const text = (event.results?.[0]?.transcript ?? "").trim();
        handlers.onResult(text);
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // already ended — nothing to do
        }
      })
    );
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("volumechange", (event) => {
        // event.value ranges roughly -2 (silent) to 10 (loud); normalize to 0..1.
        handlers.onVolume(Math.max(0, Math.min(1, (event.value + 2) / 12)));
      })
    );

    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: false,
      continuous: false,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    });

    setTimeout(() => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // already ended — nothing to do
      }
    }, 20000);
  });
}
