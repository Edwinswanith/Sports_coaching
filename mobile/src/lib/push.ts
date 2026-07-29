import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiFetch } from "./api";

let cachedToken: string | null = null;
const PUSH_CHANNEL_ID = "apex_push_high";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function supportsRemotePush(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: "Apex alerts",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
  }).catch(() => undefined);
}

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
    if (!result?.data) return;

    const res = await apiFetch("/api/device-tokens", {
      method: "POST",
      body: JSON.stringify({ token: result.data, platform: Platform.OS }),
    });
    if (res.ok) cachedToken = result.data;
  } catch {
    // Push setup is best-effort and must not block sign-in.
  }
}

export async function deregisterPushToken(): Promise<void> {
  if (!supportsRemotePush() || !cachedToken) return;
  try {
    await apiFetch("/api/device-tokens", {
      method: "DELETE",
      body: JSON.stringify({ token: cachedToken }),
    });
    cachedToken = null;
  } catch {
    // Best-effort on sign-out.
  }
}

type PushData = { title?: string; body?: string; link?: string };

export function subscribeToPushMessages(onOpenLink: (link: string) => void): () => void {
  if (!supportsRemotePush()) return () => undefined;

  const openFromData = (data: PushData | undefined) => {
    if (typeof data?.link === "string" && data.link) onOpenLink(data.link);
  };

  const lastResponse = Notifications.getLastNotificationResponse();
  openFromData(lastResponse?.notification.request.content.data as PushData | undefined);

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    openFromData(response.notification.request.content.data as PushData | undefined);
  });

  return () => {
    responseSub.remove();
  };
}
