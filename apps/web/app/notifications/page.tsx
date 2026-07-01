"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, type NavItem } from "../../components/AppShell";
import { Icon } from "../../components/ui";
import {
  relativeTime,
  useNotifications,
  type NotificationView,
} from "../../lib/notifications";
import {
  getStoredUser,
  logout as apiLogout,
  type StoredUser,
} from "../../lib/api";
import { athleteNav } from "../../lib/athleteNav";
import { coachNav, coachNavigate } from "../../lib/coachNav";
import { isKnownRole, type Role } from "../../lib/roles";

export default function NotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const {
    unreadCount,
    items,
    loading,
    loadList,
    markRead,
    markAllRead,
  } = useNotifications();

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored || !isKnownRole(stored.role)) {
      router.replace("/");
      return;
    }
    setUser(stored);
  }, [router]);

  useEffect(() => {
    if (user) loadList();
  }, [loadList, user]);

  const role = (isKnownRole(user?.role ?? "") ? user?.role : "athlete") as Role;
  const nav = useMemo(() => navForRole(role, user), [role, user]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  function onNavigate(key: string) {
    if (role === "coach") {
      coachNavigate(router, key);
      return;
    }
    if (role === "athlete") {
      if (key === "messages") router.push("/athlete/messages");
      else router.push(`/athlete/dashboard?section=${key}`);
      return;
    }
    router.push("/guardian/dashboard");
  }

  function openNotification(notification: NotificationView) {
    if (!notification.read) markRead(notification.id);
    if (notification.link) router.push(notification.link);
  }

  if (!user) return null;

  return (
    <AppShell
      role={role}
      title="Notifications"
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
      userName={user.name}
      nav={nav}
      activeKey="notifications"
      onNavigate={onNavigate}
      onSignOut={logout}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="label">Latest alerts</p>
          {unreadCount > 0 ? (
            <button onClick={markAllRead} className="text-xs font-semibold text-accent-strong">
              Mark all read
            </button>
          ) : null}
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface-card h-20 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="surface-card flex flex-col items-center gap-2 py-14 text-center">
            <span className="text-ink-faint">
              <Icon.bell />
            </span>
            <p className="font-display text-base font-semibold text-ink">No notifications yet</p>
            <p className="max-w-56 text-sm text-ink-muted">New coach, athlete, and guardian updates will appear here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((notification) => (
              <li key={notification.id}>
                <button
                  onClick={() => openNotification(notification)}
                  className={`surface-card flex w-full items-start gap-3 p-3 text-left transition hover:border-accent/40 ${
                    notification.read ? "" : "border-accent/30 bg-accent/[0.05]"
                  }`}
                >
                  <PriorityPill priority={notification.priority} read={notification.read} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className={`truncate text-sm ${notification.read ? "font-medium text-ink-muted" : "font-semibold text-ink"}`}>
                        {notification.title}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{relativeTime(notification.createdAt)}</span>
                    </span>
                    {notification.body ? (
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-ink-muted">{notification.body}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function navForRole(role: Role, user: StoredUser | null): NavItem[] {
  if (role === "coach") return coachNav(Boolean(user?.isAcademyOwner));
  if (role === "athlete") return athleteNav();
  return [
    { key: "today", label: "Today", icon: <Icon.home /> },
    { key: "trends", label: "Trends", icon: <Icon.chart /> },
    { key: "feedback", label: "Feedback", icon: <Icon.message /> },
  ];
}

function PriorityPill({ priority, read }: { priority: NotificationView["priority"]; read: boolean }) {
  const label = priority === "high" ? "Urgent" : priority;
  const classes =
    priority === "high"
      ? "bg-bad/10 text-bad"
      : priority === "medium"
      ? "bg-accent-soft text-accent-strong"
      : "bg-surface-inset text-ink-muted";
  return (
    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${read ? "bg-surface-inset text-ink-faint" : classes}`}>
      {label}
    </span>
  );
}
