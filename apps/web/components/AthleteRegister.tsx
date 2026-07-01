"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./ui";
import { PasswordInput } from "./PasswordInput";
import { apiUrl, setStoredUser } from "../lib/api";
import { dashboardPathForRole } from "../lib/roles";
import { ROLE_THEMES, accentVars } from "../lib/roleThemes";

type RegisterResponse = {
  accessToken?: string;
  user?: { id: string; name: string; email: string; role: string };
  error?: string;
};

// A short, friendly starter list. `sport` is free-text on the server, so this
// is just to make the common case one tap — "Other" lets them type their own.
const SPORTS = [
  "Football",
  "Cricket",
  "Athletics",
  "Basketball",
  "Tennis",
  "Swimming",
  "Hockey",
  "Badminton",
] as const;

/**
 * Self-service athlete sign-up. The ONE self-registration path on the platform:
 * creates an unassigned athlete (no coach, no academy) and signs them straight
 * in so they can log their own training/wellness. Themed with the athlete
 * accent to match /login/athlete.
 */
export function AthleteRegister() {
  const theme = ROLE_THEMES.athlete;
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sport, setSport] = useState<string>("");
  const [customSport, setCustomSport] = useState("");
  const [position, setPosition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const loading = status === "loading";
  const success = status === "success";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNote(null);

    const finalSport = (sport === "__other" ? customSport : sport).trim();

    if (!name.trim()) return setError("Enter your name.");
    if (!email.trim()) return setError("Enter your email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (!finalSport) return setError("Pick or enter your sport.");

    setStatus("loading");
    try {
      const response = await fetch(apiUrl("/api/auth/register-athlete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          sport: finalSport,
          position: position.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as RegisterResponse;

      if (!response.ok || !payload.user) {
        if (response.status === 409 || payload.error === "email_already_exists") {
          setError("An account with that email already exists. Try signing in instead.");
        } else if (response.status === 429) {
          setError("Too many attempts. Wait a minute and try again.");
        } else if (payload.error === "weak_password") {
          setError("Password must be at least 8 characters.");
        } else if (payload.error === "invalid_email") {
          setError("That email doesn't look right.");
        } else if (response.status >= 500) {
          setError("Server error. Please try again shortly.");
        } else {
          setError("Couldn't create your account. Check your details and try again.");
        }
        setStatus("idle");
        return;
      }

      const target = dashboardPathForRole(payload.user.role) ?? "/athlete/dashboard";
      setStoredUser(payload.user);
      setStatus("success");
      setNote("Account created — opening your athlete workspace…");
      router.push(target);
    } catch {
      setError("Unable to reach the API server.");
      setStatus("idle");
    }
  }

  return (
    <main className="shell justify-center gap-8 px-6 py-10" style={accentVars(theme)}>
      <div className="animate-rise">
        <Link
          href="/login/athlete"
          className="inline-flex items-center gap-2 text-ink-faint transition hover:text-ink"
        >
          <Icon.arrowLeft />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Back to sign in</span>
        </Link>

        <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-accent-strong">
          <Icon.spark />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Create athlete account</span>
        </div>

        <h1 className="mt-4 font-display text-[2.4rem] font-bold uppercase leading-[0.95] tracking-tight text-ink">
          Train solo.
        </h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
          Sign yourself up and start logging training, wellness and recovery — no coach needed. A coach can add you later.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="animate-rise space-y-3"
        style={{ animationDelay: "80ms" }}
        aria-busy={loading}
      >
        <label className="block">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            autoComplete="name"
            required
            disabled={loading || success}
            className="field mt-1.5 h-12"
            placeholder="Your name"
          />
        </label>

        <label className="block">
          <span className="label">Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            disabled={loading || success}
            className="field mt-1.5 h-12"
            placeholder="you@email.com"
          />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            disabled={loading || success}
            className="field h-12"
            wrapperClassName="mt-1.5"
            placeholder="At least 8 characters"
          />
        </label>

        <label className="block">
          <span className="label">Sport</span>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            required
            disabled={loading || success}
            className="field mt-1.5 h-12"
          >
            <option value="" disabled>
              Choose your sport
            </option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="__other">Other…</option>
          </select>
        </label>

        {sport === "__other" ? (
          <label className="block">
            <span className="label">Your sport</span>
            <input
              value={customSport}
              onChange={(e) => setCustomSport(e.target.value)}
              type="text"
              required
              disabled={loading || success}
              className="field mt-1.5 h-12"
              placeholder="e.g. Rowing"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="label">Position / event (optional)</span>
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            type="text"
            disabled={loading || success}
            className="field mt-1.5 h-12"
            placeholder="e.g. Striker, Sprinter"
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
          {loading ? "Creating account…" : success ? "Created ✓" : "Create my account"}
        </button>

        <p className="pt-1 text-center text-xs text-ink-muted">
          Already have an account?{" "}
          <Link href="/login/athlete" className="font-semibold text-accent-strong">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
