import { apiFetch } from "./api";
import { getVoiceLanguage, isEnglishVoiceLanguage } from "./voiceLanguage";

type TranslateResponse = { text?: string };

export async function normalizeVoiceCommandForAgent(text: string): Promise<string> {
  const command = text.trim();
  if (!command || isEnglishVoiceLanguage()) return command;
  const res = await apiFetch("/api/voice/translate", {
    method: "POST",
    body: JSON.stringify({
      text: command,
      targetLanguage: "en-US",
      mode: "command",
      sourceLanguage: getVoiceLanguage(),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as TranslateResponse;
  return res.ok && payload.text?.trim() ? payload.text.trim() : command;
}

export async function localizeAgentSpeech(text: string): Promise<string> {
  const message = text.trim();
  if (!message || isEnglishVoiceLanguage()) return message;
  const res = await apiFetch("/api/voice/translate", {
    method: "POST",
    body: JSON.stringify({
      text: message,
      targetLanguage: getVoiceLanguage(),
      mode: "reply",
      sourceLanguage: "en-US",
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as TranslateResponse;
  return res.ok && payload.text?.trim() ? payload.text.trim() : message;
}
