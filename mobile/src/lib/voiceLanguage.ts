import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type VoiceLanguage = {
  code: string;
  deepgramHint: string;
  label: string;
  nativeLabel: string;
};

export const DEFAULT_VOICE_LANGUAGE = "en-US";

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: "en-US", deepgramHint: "en", label: "English", nativeLabel: "English" },
  { code: "hi-IN", deepgramHint: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "ta-IN", deepgramHint: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { code: "te-IN", deepgramHint: "te", label: "Telugu", nativeLabel: "తెలుగు" },
  { code: "kn-IN", deepgramHint: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ" },
  { code: "ml-IN", deepgramHint: "ml", label: "Malayalam", nativeLabel: "മലയാളം" },
];

const KEY = "scp.voice.language";
let cachedLanguage = DEFAULT_VOICE_LANGUAGE;

function validLanguage(code: string | undefined | null): string {
  return VOICE_LANGUAGES.some((language) => language.code === code) ? (code as string) : DEFAULT_VOICE_LANGUAGE;
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function getVoiceLanguage(): string {
  return cachedLanguage;
}

export function getVoiceLanguageInfo(code = cachedLanguage): VoiceLanguage {
  return VOICE_LANGUAGES.find((language) => language.code === code) ?? VOICE_LANGUAGES[0];
}

export function getDeepgramLanguageHint(code = cachedLanguage): string {
  return getVoiceLanguageInfo(code).deepgramHint;
}

export function isEnglishVoiceLanguage(code = cachedLanguage): boolean {
  return getVoiceLanguageInfo(code).deepgramHint === "en";
}

export function setCachedVoiceLanguage(code: string | undefined | null): string {
  cachedLanguage = validLanguage(code);
  return cachedLanguage;
}

export async function loadVoiceLanguagePreference(fallback?: string | null): Promise<string> {
  const stored = await getStoredItem(KEY).catch(() => null);
  cachedLanguage = validLanguage(fallback ?? stored);
  return cachedLanguage;
}

export async function setVoiceLanguagePreference(code: string): Promise<string> {
  cachedLanguage = validLanguage(code);
  await setStoredItem(KEY, cachedLanguage).catch(() => undefined);
  return cachedLanguage;
}
