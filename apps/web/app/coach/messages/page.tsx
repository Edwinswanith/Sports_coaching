"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/ui";
import { AppShell } from "../../../components/AppShell";
import { coachNav, coachNavigate } from "../../../lib/coachNav";
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

type RosterAthlete = { athleteId: string; name: string; sport: string };

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

export default function CoachMessagesPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [roster, setRoster] = useState<RosterAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

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
      const [tRes, rRes] = await Promise.all([
        apiFetch("/api/coach/messages/threads"),
        apiFetch("/api/coach/athletes"),
      ]);
      if (authGuard(tRes.status)) return;
      const t = (await tRes.json().catch(() => ({}))) as { threads?: Thread[] };
      setThreads(t.threads ?? []);
      if (rRes.ok) {
        const r = (await rRes.json().catch(() => ({}))) as { athletes?: RosterAthlete[] };
        setRoster(r.athletes ?? []);
      }
    } catch {
      // soft-fail; the empty state covers it
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

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);
  const nav = coachNav(user?.isAcademyOwner, totalUnread);
  const navigate = (key: string) => coachNavigate(router, key);

  // Athletes with no thread yet — offered under "Start a conversation".
  const messagedIds = new Set(threads.map((t) => t.partyId));
  const unstarted = roster.filter((a) => !messagedIds.has(a.athleteId));

  if (!user) return null;

  return (
    <AppShell
      role="coach"
      title="Messages"
      subtitle="Direct chats with your athletes"
      userName={user.name}
      nav={nav}
      activeKey="messages"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-2xl bg-surface-inset" />
            <div className="h-16 animate-pulse rounded-2xl bg-surface-inset" />
          </div>
        ) : (
          <>
            {threads.length === 0 ? (
              <div className="surface-card flex flex-col items-center gap-1 px-4 py-10 text-center">
                <span className="text-ink-faint"><Icon.chat /></span>
                <p className="text-sm text-ink-muted">No conversations yet</p>
                <p className="text-[11px] text-ink-faint">Start one with an athlete below.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {threads.map((t) => (
                  <li key={t.partyId}>
                    <button
                      onClick={() => router.push(`/coach/messages/${t.partyId}`)}
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
                            {t.lastSenderRole === "coach" ? "You: " : ""}
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
            )}

            {unstarted.length > 0 ? (
              <div>
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="label mb-2 flex w-full items-center justify-between"
                >
                  <span>Start a conversation</span>
                  <span className="text-ink-faint">{showAll ? "Hide" : `${unstarted.length}`}</span>
                </button>
                {showAll ? (
                  <ul className="space-y-2">
                    {unstarted.map((a) => (
                      <li key={a.athleteId}>
                        <button
                          onClick={() => router.push(`/coach/messages/${a.athleteId}`)}
                          className="surface-card flex w-full items-center gap-3 p-3 text-left transition hover:border-accent/40"
                        >
                          <Avatar name={a.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{a.name}</span>
                            <span className="block truncate text-xs text-ink-muted">{a.sport}</span>
                          </span>
                          <span className="text-ink-faint"><Icon.chevron /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
