// Single source of truth for the athlete bottom navigation. The dashboard hosts
// the today/trends/log/coach sections in-page (state-driven), while "Chat" is a
// real route (/athlete/messages). Shared here so the tab bar stays identical
// across the dashboard and the messages pages.

import { Icon } from "../components/ui";
import type { NavItem } from "../components/AppShell";

/** In-page dashboard sections (everything except the routed "messages" tab). */
export const ATHLETE_SECTIONS = ["today", "achievements", "hydration", "trends", "log", "coach"] as const;
export type AthleteSection = (typeof ATHLETE_SECTIONS)[number];

export function isAthleteSection(v: string): v is AthleteSection {
  return (ATHLETE_SECTIONS as readonly string[]).includes(v);
}

export function athleteNav(opts?: {
  /** 0 coaches → the section is "Updates" (announcements only), else "Coach". */
  coachCount?: number | null;
  coachBadge?: number;
  messageBadge?: number;
}): NavItem[] {
  return [
    { key: "today", label: "Today", icon: <Icon.home /> },
    { key: "achievements", label: "Goals", icon: <Icon.trophy /> },
    { key: "hydration", label: "Water", icon: <Icon.water /> },
    { key: "trends", label: "Trends", icon: <Icon.chart /> },
    { key: "log", label: "Log", icon: <Icon.plus /> },
    {
      key: "coach",
      label: opts?.coachCount === 0 ? "Updates" : "Coach",
      icon: <Icon.message />,
      badge: opts?.coachBadge || undefined,
    },
    { key: "messages", label: "Chat", icon: <Icon.chat />, badge: opts?.messageBadge || undefined },
  ];
}
