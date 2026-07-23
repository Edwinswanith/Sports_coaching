// Design tokens for the mobile app (role accents + semantic colors).
// so the native app shares one visual identity. Light, warm off-white theme with
// a per-role accent hue.

import type { Role } from "./roles";

export const colors = {
  surface: "#f6f7f3", // warm off-white page bg
  surfaceRaised: "#ffffff", // white cards
  surfaceInset: "#f0f2ec", // pale inset (fields, tiles)
  ink: "#121816",
  inkMuted: "#5a645e",
  inkFaint: "#747e77",
  line: "rgba(17,30,17,0.08)",
  lineStrong: "rgba(17,30,17,0.14)",
  ok: "#16a34a",
  warn: "#ca8a04",
  bad: "#dc2626",
} as const;

export type IconName = "pulse" | "flash" | "heart";

export type RoleTheme = {
  role: Role;
  label: string;
  heading: string;
  subcopy: string;
  tagline: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  accentSoft: string;
  icon: IconName;
};

export const ROLE_THEMES: Record<Role, RoleTheme> = {
  coach: {
    role: "coach",
    label: "Coach",
    heading: "Coach by the numbers.",
    subcopy: "Readiness, training load and risk flags for every assigned athlete.",
    tagline: "Readiness & risk flags",
    accent: "#0b7d55",
    accentStrong: "#0a6e4d",
    accentInk: "#ffffff",
    accentSoft: "rgba(11,125,85,0.16)",
    icon: "pulse",
  },
  athlete: {
    role: "athlete",
    label: "Athlete",
    heading: "Train. Log. Recover.",
    subcopy: "Your daily check-in, sessions and recovery in under a minute.",
    tagline: "Check-in & recovery",
    accent: "#efa94e",
    accentStrong: "#9a5a0c",
    accentInk: "#1a0c00",
    accentSoft: "rgba(239,169,78,0.18)",
    icon: "flash",
  },
  guardian: {
    role: "guardian",
    label: "Guardian",
    heading: "Stay in the loop.",
    subcopy: "Follow your athlete's readiness, sessions and coach feedback.",
    tagline: "Follow your athlete",
    accent: "#0b6e7c",
    accentStrong: "#0a5e6a",
    accentInk: "#ffffff",
    accentSoft: "rgba(11,110,124,0.16)",
    icon: "heart",
  },
};

export const ROLE_THEME_LIST: RoleTheme[] = [
  ROLE_THEMES.athlete,
  ROLE_THEMES.coach,
  ROLE_THEMES.guardian,
];

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 } as const;
export const space = (n: number) => n * 4;
