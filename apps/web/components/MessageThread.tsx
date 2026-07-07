"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

export type WorkoutTableRow = {
  name: string;
  sets?: string;
  reps?: string;
  distance?: string;
  duration?: string;
  intensity?: string;
  notes?: string;
};

export type ChatMedia = {
  id: string;
  originalName: string;
  mimeType: string;
  conversion: {
    status: "none" | "pending" | "completed" | "failed";
    table: WorkoutTableRow[];
  };
};

export type ChatMessage = {
  id: string;
  body: string;
  senderRole: "coach" | "athlete";
  mine: boolean;
  read: boolean;
  createdAt: string;
  media: ChatMedia | null;
};

/** Fetches a private, cookie-authenticated file and renders it as an <img> via a blob URL. */
function AuthImage({
  src,
  alt,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const res = await apiFetch(src);
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!url) return <div className={`animate-pulse rounded-lg bg-black/10 ${className ?? ""}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset Next can optimize
  return <img src={url} alt={alt} className={className} onClick={onClick} />;
}

/** Full-screen, tap-to-dismiss view-only image viewer — WhatsApp-style. */
function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20"
      >
        ✕
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <AuthImage src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

/**
 * Chat-friendly rendering of an extracted workout as an actual column-aligned
 * table (exercise / sets / reps / distance / duration / intensity), so it
 * reads as structured data rather than a plain name list. Long plans scroll
 * inside their own capped-height card (with a sticky header row) instead of
 * growing the surrounding bubble/composer off-screen.
 */
function WorkoutTable({ rows }: { rows: WorkoutTableRow[] }) {
  return (
    <div className="mt-2 w-[280px] max-w-full overflow-hidden rounded-lg border border-line bg-surface-raised text-ink">
      <p className="border-b border-line bg-surface-inset px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-ink-faint">
        Workout plan · {rows.length} {rows.length === 1 ? "exercise" : "exercises"}
      </p>
      <div className="max-h-[38vh] overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-surface-raised">
            <tr className="text-ink-faint">
              <th className="px-2 py-1 font-semibold">Exercise</th>
              <th className="px-2 py-1 font-semibold">Sets</th>
              <th className="px-2 py-1 font-semibold">Reps</th>
              <th className="px-2 py-1 font-semibold">Rest/Dur</th>
              <th className="px-2 py-1 font-semibold">Intensity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`align-top ${i % 2 === 1 ? "bg-surface-inset/60" : ""}`}>
                <td className="px-2 py-1.5 font-semibold leading-tight text-ink">
                  {r.name}
                  {r.notes ? <p className="mt-0.5 font-normal leading-snug text-ink-faint">{r.notes}</p> : null}
                </td>
                <td className="px-2 py-1.5 text-ink-muted">{r.sets || "—"}</td>
                <td className="px-2 py-1.5 text-ink-muted">{r.reps || "—"}</td>
                <td className="px-2 py-1.5 text-ink-muted">{r.duration || r.distance || "—"}</td>
                <td className="px-2 py-1.5 text-ink-muted">{r.intensity || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Editable variant of the extracted table, used only in the pre-send review
 * card — the source image often has no explicit sets/reps/rest/intensity for
 * some rows (e.g. a bulleted warm-up list with no numbers next to it), so the
 * coach can fill those in or fix a misread before the plan reaches the
 * athlete. Once sent, the table is frozen and rendered read-only (WorkoutTable).
 */
function EditableWorkoutTable({
  rows,
  onChange,
}: {
  rows: WorkoutTableRow[];
  onChange: (rows: WorkoutTableRow[]) => void;
}) {
  function updateRow(i: number, patch: Partial<WorkoutTableRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...rows, { name: "" }]);
  }

  const cellInput =
    "w-full rounded border border-line bg-surface-base px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent";

  return (
    <div className="mt-2 w-full max-w-full overflow-hidden rounded-lg border border-line bg-surface-raised text-ink">
      <p className="border-b border-line bg-surface-inset px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-ink-faint">
        Review &amp; edit before sending · {rows.length} {rows.length === 1 ? "exercise" : "exercises"}
      </p>
      <div className="max-h-[42vh] overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-surface-raised">
            <tr className="text-ink-faint">
              <th className="px-1.5 py-1 font-semibold">Exercise</th>
              <th className="w-14 px-1.5 py-1 font-semibold">Sets</th>
              <th className="w-14 px-1.5 py-1 font-semibold">Reps</th>
              <th className="w-24 px-1.5 py-1 font-semibold">Duration</th>
              <th className="w-24 px-1.5 py-1 font-semibold">Distance</th>
              <th className="w-24 px-1.5 py-1 font-semibold">Intensity</th>
              <th className="w-8 px-1.5 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`align-top ${i % 2 === 1 ? "bg-surface-inset/60" : ""}`}>
                <td className="px-1.5 py-1">
                  <input
                    className={cellInput}
                    value={r.name}
                    placeholder="Exercise name"
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <input className={cellInput} value={r.sets ?? ""} onChange={(e) => updateRow(i, { sets: e.target.value })} />
                </td>
                <td className="px-1.5 py-1">
                  <input className={cellInput} value={r.reps ?? ""} onChange={(e) => updateRow(i, { reps: e.target.value })} />
                </td>
                <td className="px-1.5 py-1">
                  <input
                    className={cellInput}
                    value={r.duration ?? ""}
                    onChange={(e) => updateRow(i, { duration: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <input
                    className={cellInput}
                    value={r.distance ?? ""}
                    onChange={(e) => updateRow(i, { distance: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <input
                    className={cellInput}
                    value={r.intensity ?? ""}
                    onChange={(e) => updateRow(i, { intensity: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1 text-center">
                  <button
                    onClick={() => removeRow(i)}
                    aria-label="Remove row"
                    className="text-ink-faint hover:text-bad"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-2 py-1.5">
        <button onClick={addRow} className="text-[11px] font-semibold text-accent hover:underline">
          + Add exercise
        </button>
      </div>
    </div>
  );
}

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
  role,
  onAuthFailure,
}: {
  base: string;
  /** Which side is viewing — picks the role-scoped, authenticated media-file endpoint. */
  role: "coach" | "athlete";
  onAuthFailure?: (status: number) => boolean;
}) {
  const mediaFileUrl = (mediaId: string) => `/api/${role}/media/${mediaId}/file`;
  // Coach-only: derive the per-athlete upload endpoint from the messages base.
  const mediaUploadUrl = base.replace(/\/messages$/, "/media");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Coach image compose: the uploaded-but-not-yet-sent media, and a busy flag
  // covering upload/convert/send.
  const [pending, setPending] = useState<ChatMedia | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  // Coach's in-progress edits to the extracted table, kept separate from
  // `pending` until saved (PATCH) so a failed save doesn't discard them.
  const [tableDraft, setTableDraft] = useState<WorkoutTableRow[] | null>(null);
  const [tableDirty, setTableDirty] = useState(false);
  // Full-screen view-only image viewer, opened by tapping a shared image.
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
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

  // ---- Coach-only image compose: upload → (optional) convert → review → send ----
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", "workout");
      const res = await apiFetch(mediaUploadUrl, { method: "POST", body: fd });
      if (onAuthFailure?.(res.status)) return;
      const json = (await res.json().catch(() => ({}))) as { media?: ChatMedia; error?: string };
      if (!res.ok || !json.media) {
        setError(json.error === "file_too_large" ? "Image is too large." : "Couldn't upload the image.");
        return;
      }
      setPending(json.media);
      setTableDraft(null);
      setTableDirty(false);
    } catch {
      setError("Network error uploading image.");
    } finally {
      setMediaBusy(false);
    }
  }

  async function convertPending() {
    if (!pending) return;
    setMediaBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/coach/media/${pending.id}/convert`, { method: "POST" });
      if (onAuthFailure?.(res.status)) return;
      const json = (await res.json().catch(() => ({}))) as { media?: ChatMedia };
      if (res.ok && json.media) {
        setPending(json.media);
        setTableDraft(json.media.conversion.table);
        setTableDirty(false);
      } else {
        setError("Couldn't convert the image to a table.");
      }
    } catch {
      setError("Network error converting.");
    } finally {
      setMediaBusy(false);
    }
  }

  async function sendPending() {
    if (!pending) return;
    setMediaBusy(true);
    setError(null);
    try {
      if (tableDirty && tableDraft) {
        const patchRes = await apiFetch(`/api/coach/media/${pending.id}/table`, {
          method: "PATCH",
          body: JSON.stringify({ table: tableDraft }),
        });
        if (onAuthFailure?.(patchRes.status)) return;
        const patchJson = (await patchRes.json().catch(() => ({}))) as { media?: ChatMedia };
        if (!patchRes.ok || !patchJson.media) {
          setError("Couldn't save your table edits — try again before sending.");
          return;
        }
        setPending(patchJson.media);
        setTableDirty(false);
      }
      const caption = draft.trim();
      const res = await apiFetch(`/api/coach/media/${pending.id}/send`, {
        method: "POST",
        body: JSON.stringify(caption ? { caption } : {}),
      });
      if (onAuthFailure?.(res.status)) return;
      const json = (await res.json().catch(() => ({}))) as { message?: ChatMessage };
      if (!res.ok || !json.message) {
        setError("Couldn't send the image.");
        return;
      }
      setMessages((prev) => [...prev, json.message as ChatMessage]);
      lastIdRef.current = json.message.id;
      setPending(null);
      setTableDraft(null);
      setTableDirty(false);
      setDraft("");
    } catch {
      setError("Network error sending.");
    } finally {
      setMediaBusy(false);
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
                    className={`max-w-[80%] overflow-hidden rounded-2xl text-sm ${
                      m.media
                        ? ""
                        : m.mine
                          ? "border border-accent/20 bg-accent-soft text-accent-strong"
                          : "border border-line bg-surface-raised text-ink"
                    }`}
                  >
                    {m.media ? (
                      <>
                        <AuthImage
                          src={mediaFileUrl(m.media.id)}
                          alt={m.media.originalName}
                          className="block max-h-64 w-full max-w-[260px] cursor-pointer object-cover"
                          onClick={() => setViewer({ src: mediaFileUrl(m.media!.id), alt: m.media!.originalName })}
                        />
                        {m.media.conversion.status === "completed" && m.media.conversion.table.length > 0 ? (
                          <div className="pt-1.5">
                            <WorkoutTable rows={m.media.conversion.table} />
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {m.body || !m.media ? (
                      <div className={m.media ? "px-0.5 pt-1" : "px-3 py-2"}>
                        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                        <p
                          className={`mt-0.5 text-right text-[9px] ${
                            m.media ? "text-ink-faint" : m.mine ? "text-accent-strong/70" : "text-ink-faint"
                          }`}
                        >
                          {timeLabel(m.createdAt)}
                        </p>
                      </div>
                    ) : (
                      <p className="px-0.5 pb-0.5 pt-1 text-right text-[9px] text-ink-faint">{timeLabel(m.createdAt)}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="px-1 pb-1 text-xs text-bad">{error}</p> : null}

      {/* Coach-only: review an uploaded image (and optional extracted table) before sending. */}
      {pending ? (
        <div className="mb-2 rounded-xl border border-line bg-surface-inset p-2">
          <div className="flex items-start gap-2">
            <AuthImage
              src={`/api/coach/media/${pending.id}/file`}
              alt={pending.originalName}
              className="h-20 w-20 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">{pending.originalName}</p>
              <p className="text-[11px] text-ink-faint">Ready to send · caption optional below</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {pending.conversion.status === "completed" ? (
                  <span className="rounded-md bg-ok/15 px-2 py-1 text-[11px] font-semibold text-ok">Table extracted ✓</span>
                ) : (
                  <button
                    onClick={() => void convertPending()}
                    disabled={mediaBusy}
                    className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
                  >
                    {mediaBusy && pending.conversion.status === "pending" ? "Converting…" : "Convert to table"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setPending(null);
                    setTableDraft(null);
                    setTableDirty(false);
                  }}
                  disabled={mediaBusy}
                  className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
          {pending.conversion.status === "completed" ? (
            <EditableWorkoutTable
              rows={tableDraft ?? pending.conversion.table}
              onChange={(rows) => {
                setTableDraft(rows);
                setTableDirty(true);
              }}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t border-line pt-2">
        {role === "coach" ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={mediaBusy || !!pending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-lg text-ink-muted hover:text-ink disabled:opacity-50"
              aria-label="Attach image"
              title="Attach a workout image"
            >
              ＋
            </button>
          </>
        ) : null}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (pending) void sendPending();
              else void send();
            }
          }}
          rows={1}
          placeholder={pending ? "Add a caption…" : "Message…"}
          className="field h-auto max-h-28 flex-1 resize-none py-2.5 leading-snug"
        />
        <button
          onClick={() => (pending ? void sendPending() : void send())}
          disabled={pending ? mediaBusy : !draft.trim() || sending}
          className="btn-primary h-11 w-11 shrink-0 px-0"
          aria-label={pending ? "Send image" : "Send"}
        >
          ➤
        </button>
      </div>

      {viewer ? <ImageViewer src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}
