"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import {
  useNotifications,
  relativeTime,
  type NotificationView,
} from "../lib/notifications";

/**
 * Header notification bell + dropdown center. Lives in `AppShell`, so all three
 * roles get it. The panel opens as a compact dropdown anchored just under the
 * header near the bell (measured at open so it clears any header height / safe
 * area). Badge uses the role accent for normal unread and switches to the status
 * red only when something urgent (high priority) is unread — keeping the sacred
 * red = needs-attention meaning intact. Tapping a row marks it read and
 * deep-links to its source.
 */
export function NotificationCenter() {
  const router = useRouter();
  const { unreadCount, items, loading, loadList, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  // Vertical anchor: the header's bottom edge (so the dropdown hangs right below
  // it regardless of role/header height or notch). Measured each time it opens.
  const [anchorTop, setAnchorTop] = useState(64);

  useEffect(() => {
    if (!open) return;
    loadList();
    const header = document.querySelector("#app-shell header");
    if (header) setAnchorTop(Math.round(header.getBoundingClientRect().bottom + 6));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loadList]);

  function onRowClick(n: NotificationView) {
    if (!n.read) markRead(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  const badge = unreadCount > 0;
  // Always red — the conventional unread-count colour.
  const badgeColor = "bg-bad";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={badge ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="btn-ghost relative h-9 w-9 px-0"
      >
        <Icon.bell />
        {badge ? (
          <span
            className={`absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full ${badgeColor} px-1 text-[9px] font-bold text-white`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="Notifications">
          <button
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-ink/10 backdrop-blur-sm"
          />
          {/* Recreates the centered app column, fixed to the viewport, so the
              dropdown right-aligns under the bell on both phone and wide screens. */}
          <div
            className="pointer-events-none fixed inset-x-0 z-40 mx-auto w-full max-w-md px-3"
            style={{ top: anchorTop }}
          >
            <div className="pointer-events-auto ml-auto flex w-[min(21rem,100%)] origin-top-right animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-pop">
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold text-ink">Notifications</h2>
                {unreadCount > 0 ? (
                  <span className="chip chip-ok">{unreadCount} new</span>
                ) : null}
              </div>
              {unreadCount > 0 ? (
                <button onClick={markAllRead} className="text-[11px] font-semibold text-accent-strong">
                  Mark all read
                </button>
              ) : null}
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-2 pb-2">
              {loading && items.length === 0 ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-inset" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="text-ink-faint"><Icon.bell /></span>
                  <p className="text-sm text-ink-muted">You're all caught up</p>
                  <p className="text-[11px] text-ink-faint">New alerts will show up here.</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => onRowClick(n)}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-inset ${
                          n.read ? "" : "bg-accent/[0.06]"
                        }`}
                      >
                        <PriorityDot priority={n.priority} read={n.read} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`truncate text-[13px] ${n.read ? "font-medium text-ink-muted" : "font-semibold text-ink"}`}>
                              {n.title}
                            </span>
                            <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{relativeTime(n.createdAt)}</span>
                          </span>
                          {n.body ? (
                            <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-muted">{n.body}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          </div>
        </div>,
            document.getElementById("app-shell") ?? document.body
          )
        : null}
    </>
  );
}

/** Leading status dot — red (high), accent (medium), faint (low); hollow once read. */
function PriorityDot({ priority, read }: { priority: NotificationView["priority"]; read: boolean }) {
  const color = priority === "high" ? "bg-bad" : priority === "medium" ? "bg-accent" : "bg-ink-faint";
  return (
    <span className="mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      <span className={`h-2 w-2 rounded-full ${read ? "bg-line-strong" : color}`} />
    </span>
  );
}
