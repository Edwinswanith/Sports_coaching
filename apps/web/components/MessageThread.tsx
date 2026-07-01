"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

export type ChatMessage = {
  id: string;
  body: string;
  senderRole: "coach" | "athlete";
  mine: boolean;
  read: boolean;
  createdAt: string;
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yest.toDateString();
  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Reusable coach⇄athlete chat surface, shared by both roles' chat pages.
 *
 * `base` is the role-specific messages endpoint:
 *   coach   → `/api/coach/athletes/<athleteId>/messages`
 *   athlete → `/api/athlete/messages/<coachId>`
 * The component GETs `base` for history, POSTs `base` to send, and POSTs
 * `base/read` to clear unread. Near-real-time delivery is by short-poll while
 * the thread is open (no WebSocket yet).
 */
export function MessageThread({
  base,
  onAuthFailure,
}: {
  base: string;
  onAuthFailure?: (status: number) => boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const markRead = useCallback(async () => {
    await apiFetch(`${base}/read`, { method: "POST" }).catch(() => undefined);
  }, [base]);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const res = await apiFetch(base);
        if (onAuthFailure?.(res.status)) return;
        if (!res.ok) {
          if (initial) setError("Couldn't load this conversation.");
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { messages?: ChatMessage[] };
        const next = json.messages ?? [];
        const newLast = next.length ? next[next.length - 1].id : null;
        const changed = newLast !== lastIdRef.current || next.length !== messages.length;
        if (changed) {
          lastIdRef.current = newLast;
          setMessages(next);
          // A new inbound message arrived (or first load) → clear unread.
          if (next.some((m) => !m.mine && !m.read)) void markRead();
        }
        setError(null);
      } catch {
        if (initial) setError("Network error.");
      } finally {
        if (initial) setLoading(false);
      }
    },
    // messages.length is read but we intentionally don't re-create on every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, markRead, onAuthFailure]
  );

  // Initial load + mark read.
  useEffect(() => {
    setLoading(true);
    lastIdRef.current = null;
    void load(true).then(() => void markRead());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Poll while the thread is open (every 4s).
  useEffect(() => {
    const id = setInterval(() => void load(false), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Keep pinned to the newest message.
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(base, { method: "POST", body: JSON.stringify({ body: text }) });
      if (onAuthFailure?.(res.status)) return;
      const json = (await res.json().catch(() => ({}))) as { message?: ChatMessage };
      if (!res.ok || !json.message) {
        setError("Couldn't send. Please try again.");
        return;
      }
      setMessages((prev) => [...prev, json.message as ChatMessage]);
      lastIdRef.current = json.message.id;
      setDraft("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-12.5rem)] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pb-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-surface-inset" />
            <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-surface-inset" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-ink-muted">No messages yet</p>
            <p className="text-[11px] text-ink-faint">Say hello to start the conversation.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay =
              !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            return (
              <div key={m.id}>
                {showDay ? (
                  <p className="my-2 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    {dayLabel(m.createdAt)}
                  </p>
                ) : null}
                <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.mine
                        ? "bg-accent text-accent-ink"
                        : "border border-line bg-surface-raised text-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p
                      className={`mt-0.5 text-right text-[9px] ${
                        m.mine ? "text-accent-ink/70" : "text-ink-faint"
                      }`}
                    >
                      {timeLabel(m.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="px-1 pb-1 text-xs text-bad">{error}</p> : null}

      <div className="flex items-end gap-2 border-t border-line pt-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Message…"
          className="field h-auto max-h-28 flex-1 resize-none py-2.5 leading-snug"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="btn-primary h-11 w-11 shrink-0 px-0"
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
