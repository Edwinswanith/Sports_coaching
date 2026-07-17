"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../components/Card";
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

type Announcement = { id: string; body: string; recipientCount: number; createdAt: string };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function CoachAnnouncementsPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [items, setItems] = useState<Announcement[]>([]);
  const [athleteCount, setAthleteCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const [annRes, athRes] = await Promise.all([
        apiFetch("/api/coach/announcements"),
        apiFetch("/api/coach/athletes"),
      ]);
      if (authGuard(annRes.status)) return;
      const ann = (await annRes.json().catch(() => ({}))) as { announcements?: Announcement[] };
      setItems(ann.announcements ?? []);
      if (athRes.ok) {
        const ath = (await athRes.json().catch(() => ({}))) as { athletes?: unknown[] };
        setAthleteCount(ath.athletes?.length ?? 0);
      }
    } catch {
      setError("Couldn't load announcements.");
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

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/coach/announcements", {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      if (authGuard(res.status)) return;
      const json = (await res.json().catch(() => ({}))) as {
        announcement?: Announcement;
        recipientCount?: number;
      };
      if (!res.ok || !json.announcement) {
        setError("Couldn't send. Please try again.");
        return;
      }
      setItems((prev) => [json.announcement as Announcement, ...prev]);
      setBody("");
      setInfo(`Sent to ${json.recipientCount ?? athleteCount} athlete${(json.recipientCount ?? athleteCount) === 1 ? "" : "s"}.`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = coachNav(user?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  if (!user) return null;

  const remaining = 1000 - body.length;

  return (
    <AppShell
      role="coach"
      title="Announcements"
      subtitle="Broadcast to your whole squad"
      userName={user.name}
      nav={nav}
      activeKey="announce"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        <div data-tour="coach-announce-page">
        <Card title="Message your squad">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder={'e.g. "Sunday swimming class starts at 7:00 AM."'}
            className="field h-auto resize-none py-2.5 leading-snug"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-ink-faint">
              Goes to all {athleteCount} assigned athlete{athleteCount === 1 ? "" : "s"}
            </span>
            <span className="text-[11px] text-ink-faint">{remaining}</span>
          </div>
          {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
          {info ? <p className="mt-2 text-xs text-accent-strong">{info}</p> : null}
          <button onClick={send} disabled={!body.trim() || sending} className="btn-primary mt-3 w-full">
            {sending ? "Sending…" : `Send to ${athleteCount} athlete${athleteCount === 1 ? "" : "s"}`}
          </button>
        </Card>
        </div>

        <div>
          <p className="label mb-2">Sent</p>
          {loading ? (
            <div className="h-20 animate-pulse rounded-2xl bg-surface-inset" />
          ) : items.length === 0 ? (
            <div className="surface-card flex flex-col items-center gap-1 px-4 py-10 text-center">
              <span className="text-ink-faint"><Icon.message /></span>
              <p className="text-sm text-ink-muted">No announcements yet</p>
              <p className="text-[11px] text-ink-faint">Your team updates will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((a) => (
                <li key={a.id} className="surface-card p-3">
                  <p className="whitespace-pre-wrap text-sm text-ink">{a.body}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-faint">
                    <span>{relativeTime(a.createdAt)}</span>
                    <span aria-hidden>·</span>
                    <span>{a.recipientCount} recipient{a.recipientCount === 1 ? "" : "s"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AppShell>
  );
}
