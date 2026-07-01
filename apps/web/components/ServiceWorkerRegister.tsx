"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker once on the client. Kept in its own tiny
 * client component so the root layout can stay a server component. Registration
 * is best-effort — failure never affects the app.
 */
const isProduction = process.env.NODE_ENV === "production";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // In development a cached service worker serves a STALE app shell — it hides
    // code changes and causes phantom hydration mismatches. So in dev we never
    // register, and we actively tear down any SW + caches a previous run left
    // behind, so the dev environment self-heals without manual DevTools clearing.
    if (!isProduction) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => undefined);
      if (window.caches) {
        caches
          .keys()
          .then((keys) => keys.forEach((k) => caches.delete(k)))
          .catch(() => undefined);
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    // If the page already finished loading (common when React hydrates after
    // the load event), register immediately; otherwise wait for load so SW
    // registration never competes with critical first-paint requests.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
