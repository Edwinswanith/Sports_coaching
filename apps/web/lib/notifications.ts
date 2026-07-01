"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

export type NotificationPriority = "high" | "medium" | "low";

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  link: string | null;
  read: boolean;
  createdAt: string;
};

type UnreadResp = { unreadCount: number; hasUrgentUnread: boolean };
type ListResp = UnreadResp & { notifications: NotificationView[] };

const POLL_MS = 60_000;

/**
 * Notification state for the header bell + center. Polls the lightweight
 * unread-count on an interval (cheap), and fetches the full list on demand
 * (when the center opens). Read actions update locally and refresh the count.
 */
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasUrgent, setHasUrgent] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  const refreshCount = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const json = (await res.json()) as UnreadResp;
      if (!mounted.current) return;
      setUnreadCount(json.unreadCount);
      setHasUrgent(json.hasUrgentUnread);
    } catch {
      /* offline / transient — keep last known count */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/notifications?limit=40");
      if (!res.ok) return;
      const json = (await res.json()) as ListResp;
      if (!mounted.current) return;
      setItems(json.notifications);
      setUnreadCount(json.unreadCount);
      setHasUrgent(json.hasUrgentUnread);
    } catch {
      /* surfaced as empty list; count poll continues */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST", body: "{}" });
    } finally {
      refreshCount();
    }
  }, [refreshCount]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    setHasUrgent(false);
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST", body: "{}" });
    } finally {
      refreshCount();
    }
  }, [refreshCount]);

  useEffect(() => {
    mounted.current = true;
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [refreshCount]);

  return { unreadCount, hasUrgent, items, loading, loadList, markRead, markAllRead };
}

/** "just now" / "12m" / "3h" / "2d" — compact relative time for the list. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
