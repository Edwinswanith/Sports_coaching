"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiUrl, setStoredUser } from "../lib/api";
import { dashboardPathForRole, type Role } from "../lib/roles";

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GIS_SRC = "https://accounts.google.com/gsi/client";

// Minimal shape of the Google Identity Services global we rely on.
type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: {
        client_id: string;
        callback: (resp: { credential?: string }) => void;
      }) => void;
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

/**
 * Renders Google's branded button, exchanges the returned ID token at
 * /api/auth/google, then routes by the server-returned role. For first-time
 * Google identities, `requestedRole` controls whether the API creates an
 * independent athlete or coach.
 */
export function GoogleSignInButton({
  requestedRole,
  onError,
  onNote,
}: {
  requestedRole: Role;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;

    async function handleCredential(credential: string) {
      try {
        const res = await fetch(apiUrl("/api/auth/google"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ credential, requestedRole }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          user?: { role: string };
          error?: string;
        };
        if (!res.ok || !payload.user) {
          if (payload.error === "self_signup_role_not_supported") {
            onError("Google sign-in for this role requires an existing account.");
          } else if (res.status === 403) {
            onError("That Google account cannot sign in right now.");
          } else if (res.status === 503) {
            onError("Google sign-in isn't available right now.");
          } else if (res.status === 429) {
            onError("Too many attempts. Wait a minute and try again.");
          } else {
            onError("Google sign-in failed. Please try again.");
          }
          return;
        }
        const target = dashboardPathForRole(payload.user.role);
        if (!target) {
          onError("Your workspace isn't available yet.");
          return;
        }
        setStoredUser(payload.user as Parameters<typeof setStoredUser>[0]);
        onNote("Signed in — opening your workspace…");
        router.push(target);
      } catch {
        onError("Unable to reach the API server.");
      }
    }

    loadGis()
      .then(() => {
        if (cancelled || !window.google || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            if (resp.credential) handleCredential(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
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
  }, [router, requestedRole, onError, onNote]);

  if (!clientId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div ref={ref} className="flex justify-center" />
    </div>
  );
}
