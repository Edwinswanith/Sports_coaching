// Remote push registration (Firebase Cloud Messaging), native platforms only.
//
// Uses expo-notifications' getDevicePushTokenAsync() — in SDK 56 this returns
// the RAW native FCM (Android) / APNs (iOS) token directly, so no
// @react-native-firebase dependency is needed at all; the already-installed
// expo-notifications package covers both the existing local hydration
// reminders AND remote push token acquisition. A custom EAS dev-client build
// is still required either way — Expo Go doesn't support push on Android from
// SDK 53+ — that requirement doesn't go away, only the extra native package does.
//
// Data-only end-to-end (matches server/src/services/fcmDelivery.ts and the web
// client): the server never sends an FCM "notification" block, so display is
// always our own code, not the OS's automatic tray. Known trade-off: unlike
// the web service worker (whose `push` event fires regardless of tab state),
// a fully-killed native app process has no guaranteed way to display a
// data-only push — these listeners cover foreground and backgrounded-but-
// running app instances, which is the overwhelming majority of real usage.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api";

let cachedToken: string | null = null;

function supportsRemotePush(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("general", {
    name: "General",
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
}

/**
 * Requests notification permission (only if not already decided) and, once
 * granted, registers the resulting device push token with the server. Safe
 * to call on every sign-in — cheap no-op once already registered. Never throws.
 */
export async function registerPushToken(): Promise<void> {
  if (!supportsRemotePush()) return;
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const result = await Notifications.getDevicePushTokenAsync();
    if (!result?.data || result.data === cachedToken) return;
    cachedToken = result.data;

    await apiFetch("/api/device-tokens", {
      method: "POST",
      body: JSON.stringify({ token: result.data, platform: Platform.OS }),
    });
  } catch {
    // Best-effort — a push registration failure must never break sign-in.
  }
}

/** Deregisters the current token from the server (call on sign-out). */
export async function deregisterPushToken(): Promise<void> {
  if (!supportsRemotePush() || !cachedToken) return;
  try {
    await apiFetch("/api/device-tokens", {
      method: "DELETE",
      body: JSON.stringify({ token: cachedToken }),
    });
    cachedToken = null;
  } catch {
    // Best-effort.
  }
}

type PushData = { type?: string; title?: string; body?: string; link?: string };

/**
 * Wires up display (foreground/backgrounded-but-running) + tap-to-navigate
 * for incoming data-only pushes. Call once near the app root (after sign-in,
 * so `router` navigation targets a mounted layout). Returns an unsubscribe fn.
 */
export function subscribeToPushMessages(onOpenLink: (link: string) => void): () => void {
  if (!supportsRemotePush()) return () => undefined;

  const receivedSub = Notifications.addNotificationReceivedListener(async (event) => {
    const data = event.request.content.data as PushData | undefined;
    if (!data?.title) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: data.title, body: data.body ?? "", data: { link: data.link ?? "" } },
      trigger: null,
    }).catch(() => undefined);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const link = response.notification.request.content.data?.link;
    if (typeof link === "string" && link) onOpenLink(link);
  });

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}
