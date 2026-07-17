"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/ui";
import { AppShell } from "../../../components/AppShell";
import { athleteNav } from "../../../lib/athleteNav";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../lib/api";

type Thread = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "coach" | "athlete";
  unreadCount: number;
};

type Coach = { coachId: string; name: string };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function AthleteMessagesPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);

  function authGuard(httpStatus: number): boolean {
    if (isAuthFailure(httpStatus)) {
      clearSession();
      router.replace("/");
      return true;
    }
    return false;
  }

  async function load() {
    try {
      const [tRes, cRes] = await Promise.all([
        apiFetch("/api/athlete/messages/threads"),
        apiFetch("/api/athlete/coaches"),
      ]);
      if (authGuard(tRes.status)) return;
      const t = (await tRes.json().catch(() => ({}))) as { threads?: Thread[] };
      setThreads(t.threads ?? []);
      if (cRes.ok) {
        const c = (await cRes.json().catch(() => ({}))) as { coaches?: Coach[] };
        setCoaches(c.coaches ?? []);
      }
    } catch {
      // soft-fail
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
    setUser(stored);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = athleteNav({ coachCount: coaches.length });
  const navigate = (key: string) => {
    if (key === "messages") return;
    router.push(`/athlete/dashboard?section=${key}`);
  };

  if (!user) return null;

  const messagedIds = new Set(threads.map((t) => t.partyId));
  const unstarted = coaches.filter((c) => !messagedIds.has(c.coachId));

  return (
    <AppShell
      role="athlete"
      title="Messages"
      subtitle="Chat with your coach"
      userName={user.name}
      nav={nav}
      activeKey="messages"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4" data-tour="athlete-chat">
        {loading ? (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-2xl bg-surface-inset" />
            <div className="h-16 animate-pulse rounded-2xl bg-surface-inset" />
          </div>
        ) : coaches.length === 0 && threads.length === 0 ? (
          <div className="surface-card flex flex-col items-center gap-1 px-4 py-10 text-center">
            <span className="text-ink-faint"><Icon.chat /></span>
            <p className="text-sm text-ink-muted">No coach yet</p>
            <p className="text-[11px] text-ink-faint">
              When a coach adds you to their squad, you can message them here.
            </p>
          </div>
        ) : (
          <>
            {threads.length > 0 ? (
              <ul className="space-y-2">
                {threads.map((t) => (
                  <li key={t.partyId}>
                    <button
                      onClick={() => router.push(`/athlete/messages/${t.partyId}`)}
                      className="surface-card flex w-full items-center gap-3 p-3 text-left transition hover:border-accent/40"
                    >
                      <Avatar name={t.partyName} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{t.partyName}</span>
                          <span className="shrink-0 text-[10px] text-ink-faint">{relativeTime(t.lastAt)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="truncate text-xs text-ink-muted">
                            {t.lastSenderRole === "athlete" ? "You: " : ""}
                            {t.lastMessage}
                          </span>
                          {t.unreadCount ? (
                            <span className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                              {t.unreadCount}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {unstarted.length > 0 ? (
              <div>
                <p className="label mb-2">{threads.length > 0 ? "Other coaches" : "Your coaches"}</p>
                <ul className="space-y-2">
                  {unstarted.map((c) => (
                    <li key={c.coachId}>
                      <button
                        onClick={() => router.push(`/athlete/messages/${c.coachId}`)}
                        className="surface-card flex w-full items-center gap-3 p-3 text-left transition hover:border-accent/40"
                      >
                        <Avatar name={c.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                          <span className="block truncate text-xs text-ink-muted">Tap to start a chat</span>
                        </span>
                        <span className="text-ink-faint"><Icon.chevron /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>
    </AppShell>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-strong">
      {initials || "?"}
    </span>
  );
}
