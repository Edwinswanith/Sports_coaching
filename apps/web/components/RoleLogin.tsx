"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./ui";
import { PasswordInput } from "./PasswordInput";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { apiUrl, setStoredUser } from "../lib/api";
import { dashboardPathForRole } from "../lib/roles";
import { ROLE_THEMES, accentVars, type IconKey } from "../lib/roleThemes";
import type { Role } from "../lib/roles";

type LoginResponse = {
  accessToken?: string;
  user?: { id: string; name: string; email: string; role: string };
  error?: string;
};

const ICONS: Record<IconKey, () => JSX.Element> = {
  shield: Icon.shield,
  pulse: Icon.pulse,
  spark: Icon.spark,
  heart: Icon.heart,
};

function keepFieldVisible(input: HTMLElement) {
  window.setTimeout(() => {
    input.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 250);
}

/**
 * The single login form shared by every /login/<role> page.
 *
 * `role` selects the visual theme and first-time Google signup role. Existing
 * accounts still route by the SERVER-returned role, so a saved account cannot
 * be switched just by choosing a different login page.
 */
export function RoleLogin({ role }: { role: Role }) {
  const theme = ROLE_THEMES[role];
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const RoleIcon = ICONS[theme.icon];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNote(null);

    // Field validation (in addition to native required/email).
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setStatus("loading");
    try {
      const response = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = (await response.json().catch(() => ({}))) as LoginResponse;

      if (!response.ok || !payload.user) {
        if (response.status === 429 || payload.error === "too_many_login_attempts") {
          setError("Too many sign-in attempts. Wait a minute and try again.");
        } else if (response.status === 401 || response.status === 403) {
          setError("Invalid email or password.");
        } else if (response.status >= 500) {
          setError("Server error. Please try again shortly.");
        } else {
          setError("Invalid email or password.");
        }
        setStatus("idle");
        return;
      }

      const target = dashboardPathForRole(payload.user.role);
      if (!target) {
        setError(`The ${payload.user.role} workspace isn't available yet.`);
        setStatus("idle");
        return;
      }

      setStoredUser(payload.user);
      setStatus("success");

      // The page theme is cosmetic; honor the SERVER role for routing.
      if (payload.user.role !== role) {
        const realLabel = ROLE_THEMES[payload.user.role as Role]?.label ?? payload.user.role;
        setNote(`Signed in — taking you to your ${realLabel} workspace…`);
      } else {
        setNote(`Signed in — opening your ${theme.label} workspace…`);
      }
      router.push(target);
    } catch {
      setError("Unable to reach the API server.");
      setStatus("idle");
    }
  }

  const loading = status === "loading";
  const success = status === "success";

  return (
    <main
      className="shell min-h-[100dvh] justify-start gap-7 overflow-y-auto px-6 pb-36 pt-10"
      style={{ ...accentVars(theme), scrollPaddingBottom: "12rem" }}
    >
      <div className="animate-rise">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-ink-faint transition hover:text-ink"
        >
          <Icon.arrowLeft />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">All roles</span>
        </Link>

        <div className="mt-8 flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-ink-muted">
            Apex
          </span>
        </div>

        <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-accent-strong">
          <RoleIcon />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{theme.label} login</span>
        </div>

        <h1 className="mt-4 font-display text-[2.4rem] font-bold uppercase leading-[0.95] tracking-tight text-ink">
          {theme.heading}
        </h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">{theme.subcopy}</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="animate-rise space-y-3"
        style={{ animationDelay: "80ms" }}
        aria-busy={loading}
      >
        <label className="block">
          <span className="label">Email</span>
          <input
            id="login-email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            disabled={loading || success}
            onFocus={(e) => keepFieldVisible(e.currentTarget)}
            className="field mt-1.5 h-12"
            placeholder="you@academy.com"
          />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <PasswordInput
            id="login-password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={loading || success}
            onFocus={(e) => keepFieldVisible(e.currentTarget)}
            className="field h-12"
            wrapperClassName="mt-1.5"
            placeholder="••••••••"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">
            {error}
          </p>
        ) : null}

        {note ? (
          <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2.5 text-sm text-ok">
            {note}
          </p>
        ) : null}

        <button type="submit" disabled={loading || success} className="btn-primary h-12 w-full">
          {loading ? "Signing in…" : success ? "Signed in ✓" : `Sign in as ${theme.label.toLowerCase()}`}
        </button>

        <GoogleSignInButton requestedRole={role} onError={setError} onNote={setNote} />

        {role === "athlete" ? (
          <p className="pt-1 text-center text-xs text-ink-muted">
            New here?{" "}
            <Link href="/register/athlete" className="font-semibold text-accent-strong">
              Create an athlete account
            </Link>
          </p>
        ) : null}
      </form>
    </main>
  );
}

function Mark() {
  return (
    <span className="relative inline-flex h-8 w-8 items-center justify-center">
      <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
        <circle cx="16" cy="16" r="13" fill="none" stroke="var(--surface-inset)" strokeWidth="4" />
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 13}
          strokeDashoffset={2 * Math.PI * 13 * 0.28}
          style={{ filter: "drop-shadow(0 0 5px var(--accent))" }}
        />
      </svg>
    </span>
  );
}
