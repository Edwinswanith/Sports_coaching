import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "./AppText";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole, type Role } from "../lib/roles";
import { colors } from "../lib/theme";

// The web OAuth client ID, same one baked in at deploy time via
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (see deploy.bat) — matches GOOGLE_CLIENT_ID
// on the API so it accepts the token audience.
const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  "895210689446-ogejtfnpokvmh6kstejcj6oeag0cfl9o.apps.googleusercontent.com";
const GOOGLE_ALLOWED_ORIGINS = (
  process.env.EXPO_PUBLIC_GOOGLE_ALLOWED_ORIGINS ??
  "https://scp-web-futtj2vwgq-el.a.run.app,https://scp-web-895210689446.asia-south1.run.app"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const GIS_SRC = "https://accounts.google.com/gsi/client";

// Minimal shape of the Google Identity Services global we rely on.
type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window {
    google?: GoogleId;
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gis_load_failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(s);
  });
}

function isAllowedGoogleOrigin(): boolean {
  if (typeof window === "undefined") return false;
  if (!GOOGLE_ALLOWED_ORIGINS.length) return true;
  return GOOGLE_ALLOWED_ORIGINS.includes(window.location.origin);
}

/**
 * Web-only counterpart to GoogleSignInButton.tsx — Metro/Expo picks this file
 * automatically when bundling for the web platform. The native module used
 * by the .tsx version (@react-native-google-signin/google-signin) has no
 * browser implementation; there, `hasPlayServices()` always rejects with
 * PLAY_SERVICES_NOT_AVAILABLE, since "Play Services" isn't a concept in a
 * browser. So this build instead loads Google Identity Services directly —
 * the same approach as apps/web's own GoogleSignInButton — and reuses the
 * shared useAuth().signInWithGoogle for the token exchange + result handling
 * so both platforms produce identical outcomes from the same ID token.
 */
export function GoogleSignInButton({
  requestedRole,
  onError,
}: {
  requestedRole: Role;
  onError: (msg: string | null) => void;
}) {
  const { signInWithGoogle } = useAuth();
  const router = useRouter();
  const ref = useRef<View>(null);

  useEffect(() => {
    if (!WEB_CLIENT_ID || !ref.current || !isAllowedGoogleOrigin()) return;
    let cancelled = false;

    async function handleCredential(credential: string) {
      onError(null);
      try {
        const result = await signInWithGoogle(credential, requestedRole);
        if (!result.ok) {
          if (result.error === "self_signup_role_not_supported") {
            onError("Google sign-in for this role requires an existing account.");
          } else if (result.status === 403) {
            onError("That Google account cannot sign in right now.");
          } else if (result.status === 503) {
            onError("Google sign-in is not available right now.");
          } else if (result.status === 429) {
            onError("Too many attempts. Wait a minute and try again.");
          } else if (result.status === 401 && result.error === "invalid_google_token") {
            onError("Google token was rejected by the API. Check the Android/Web OAuth client IDs.");
          } else if (result.status === 0) {
            onError("Unable to reach the API server. Check your connection.");
          } else {
            onError(`Google sign-in failed (${result.error}).`);
          }
          return;
        }
        const dest = dashboardPathForRole(result.user.role);
        if (dest) router.replace(dest as never);
      } catch {
        onError("Could not sign in with Google.");
      }
    }

    loadGis()
      .then(() => {
        if (cancelled || !window.google || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: WEB_CLIENT_ID,
          callback: (resp) => {
            if (resp.credential) void handleCredential(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(ref.current as unknown as HTMLElement, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "pill",
          logo_alignment: "center",
        });
      })
      .catch(() => onError("Couldn't load Google sign-in."));

    return () => {
      cancelled = true;
    };
  }, [requestedRole, onError, router, signInWithGoogle]);

  if (!WEB_CLIENT_ID || !isAllowedGoogleOrigin()) return null;

  return (
    <View style={{ gap: 14, marginTop: 4 }}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>OR</Text>
        <View style={styles.line} />
      </View>
      <View ref={ref} style={{ alignItems: "center" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  or: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
});
