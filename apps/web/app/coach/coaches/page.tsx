"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../components/Card";
import { Icon } from "../../../components/ui";
import { AppShell } from "../../../components/AppShell";
import { coachNav, coachNavigate } from "../../../lib/coachNav";
import { CopyableSecret } from "../../../components/CopyableSecret";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../lib/api";

type Coach = { userId: string; name: string; email: string; isAcademyOwner: boolean };
type CreatedCoach = { coach: { userId: string; name: string; email: string }; tempPassword: string };

const ERROR_COPY: Record<string, string> = {
  email_already_exists: "That email is already registered to another account.",
  invalid_name: "Please enter a name.",
  invalid_email: "Please enter a valid email address.",
  forbidden_not_owner: "Only the academy owner can add coaches.",
};

export default function CoachesPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-coach form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCoach | null>(null);

  function authGuard(httpStatus: number): boolean {
    if (isAuthFailure(httpStatus)) {
      clearSession();
      router.replace("/");
      return true;
    }
    return false;
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/coach/coaches");
      if (res.status === 403) {
        router.replace("/coach/dashboard");
        return;
      }
      if (authGuard(res.status)) return;
      const json = (await res.json()) as { coaches?: Coach[] };
      setCoaches(json.coaches ?? []);
    } catch {
      setLoadError("Unable to load coaches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    if (!stored.isAcademyOwner) {
      router.replace("/coach/dashboard");
      return;
    }
    setUser(stored);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await apiFetch("/api/coach/coaches", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (authGuard(res.status)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(ERROR_COPY[json?.error] ?? "Could not add the coach. Please try again.");
        return;
      }
      setCreated(json as CreatedCoach);
      setStatus("idle");
      setName("");
      setEmail("");
      void load();
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = coachNav(true);
  const navigate = (key: string) => coachNavigate(router, key);

  if (!user) return null;

  return (
    <AppShell
      role="coach"
      title="Coaches"
      subtitle="Academy owner"
      userName={user.name}
      nav={nav}
      activeKey="coaches"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        <Card title="Add a coach">
          {created ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                {created.coach.name} can now sign in as a coach and build their own squad. Share these details:
              </p>
              <CopyableSecret label="Email" value={created.coach.email} />
              <CopyableSecret label="Temporary password" value={created.tempPassword} />
              <p className="text-[11px] text-ink-faint">Shown once — copy it now.</p>
              <button onClick={() => setCreated(null)} className="btn-secondary w-full justify-center">
                Add another coach
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-3">
              <label className="block">
                <span className="label">Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Coach Singh" className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="label">Email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="coach@email.com" className="field mt-1.5" />
              </label>
              {error ? (
                <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
              ) : null}
              <button type="submit" disabled={status === "saving"} className="btn-primary mt-1 w-full">
                {status === "saving" ? "Creating…" : "Create coach"}
              </button>
            </form>
          )}
        </Card>

        <div>
          <p className="label mb-2">Academy coaches</p>
          {loading ? (
            <div className="grid gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="surface-card h-16 animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{loadError}</div>
          ) : (
            <div className="grid gap-2">
              {coaches.map((c) => (
                <div key={c.userId} className="surface-card flex items-center gap-3 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                    <Icon.users />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-[11px] text-ink-muted">{c.email}</span>
                  </span>
                  {c.isAcademyOwner ? <span className="chip bg-accent-soft text-accent-strong">Owner</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
