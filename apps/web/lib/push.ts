"use client";

// Web push registration (Firebase Cloud Messaging). Mirrors the "empty env =
// feature disabled" convention already used for Google sign-in / Gemini: if
// any NEXT_PUBLIC_FIREBASE_* value is missing, every function here is a no-op.
//
// Deliberately data-only end-to-end: the server (see server/src/services/
// fcmDelivery.ts) always sends a data-only FCM payload, so display + deep-link
// handling live entirely in the service worker's `push` event listener
// (public/sw.js) — not in firebase/messaging's onMessage(), which only fires
// for a foreground tab and would mean two separate display code paths.

import { apiFetch } from "./api";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};
const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

const configured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId &&
    vapidKey
);

let cachedToken: string | null = null;

export function isPushConfigured(): boolean {
  return configured;
}

async function getMessagingInstance() {
  if (!configured || typeof window === "undefined") return null;
  const [{ initializeApp, getApps, getApp }, { getMessaging, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported().catch(() => false))) return null;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getMessaging(app);
}

/**
 * Requests notification permission (only if not already decided) and, once
 * granted, registers the resulting FCM token with the server. Safe to call on
 * every authenticated page load — it's a fast no-op once already registered
 * for this browser/permission state. Never throws.
 */
export async function ensurePushRegistered(): Promise<void> {
  try {
    if (!configured || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") return;
    }
    if (Notification.permission !== "granted") return;

    const messaging = await getMessagingInstance();
    if (!messaging) return;

    const registration = await navigator.serviceWorker.ready;
    const { getToken } = await import("firebase/messaging");
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token || token === cachedToken) return;
    cachedToken = token;

    await apiFetch("/api/device-tokens", {
      method: "POST",
      body: JSON.stringify({ token, platform: "web" }),
    });
  } catch {
    // Best-effort — a push registration failure must never break the app.
  }
}

/** Deregisters the current token from the server (call on logout). */
export async function deregisterPushToken(): Promise<void> {
  try {
    if (!cachedToken) return;
    await apiFetch("/api/device-tokens", {
      method: "DELETE",
      body: JSON.stringify({ token: cachedToken }),
    });
    cachedToken = null;
  } catch {
    // Best-effort.
  }
}
