// Single source of truth for the coach bottom navigation, shared by every coach
// page so the tab bar stays identical as you move between them. Adding/removing
// a coach tab happens here once, not in five page files.

import { Icon } from "../components/ui";
import type { NavItem } from "../components/AppShell";

const ROUTES: Record<string, string> = {
  overview: "/coach/dashboard",
  roster: "/coach/athletes",
  messages: "/coach/messages",
  announce: "/coach/announcements",
  coaches: "/coach/coaches",
};

/** Build the coach nav; the academy-owner "Coaches" tab is appended only for owners. */
export function coachNav(isOwner?: boolean, messageBadge?: number): NavItem[] {
  return [
    { key: "overview", label: "Squad", icon: <Icon.gauge /> },
    { key: "roster", label: "Roster", icon: <Icon.users /> },
    { key: "messages", label: "Messages", icon: <Icon.chat />, badge: messageBadge || undefined },
    { key: "announce", label: "Announce", icon: <Icon.message /> },
    ...(isOwner ? [{ key: "coaches", label: "Coaches", icon: <Icon.shield /> }] : []),
  ];
}

/** Route to the page for a nav key (no-op if it's the current page's key). */
export function coachNavigate(router: { push: (href: string) => void }, key: string): void {
  const href = ROUTES[key];
  if (href) router.push(href);
}
