// Per-role visual identity for the themed login entries + the role chooser.
//
// Pure data only (strings + RGB channel triplets + an icon KEY) so it is safe
// to import in both server and client components and trivial to unit-test.
// The accent triplets override the same CSS custom properties defined in
// globals.css (--accent-rgb / --accent-strong-rgb / --accent-ink-rgb), so a
// page that scopes them on a wrapper retints .btn-primary, .field focus rings,
// .surface-card accents, etc. — no token duplication.

import type { CSSProperties } from "react";
import type { Role } from "./roles";

export type IconKey = "shield" | "pulse" | "spark" | "heart";

export type RoleTheme = {
  role: Role;
  /** Short noun shown as the role indicator chip + heading suffix. */
  label: string;
  /** Hero heading line under the brand mark. */
  heading: string;
  /** One-line, role-appropriate subcopy (login hero). */
  subcopy: string;
  /** Short teaser for the compact role-chooser card. */
  tagline: string;
  /** Bright accent — fills, rings, active states. "R G B" channel triplet. */
  accentRgb: string;
  /** Deep accent — accent TEXT on the light surface. */
  accentStrongRgb: string;
  /** Text color placed ON an accent fill (contrast-tuned per hue). */
  accentInkRgb: string;
  icon: IconKey;
};

export const ROLE_THEMES: Record<Role, RoleTheme> = {
  coach: {
    role: "coach",
    label: "Coach",
    heading: "Coach by the numbers.",
    subcopy: "Readiness, training load and risk flags for every assigned athlete.",
    tagline: "Readiness & risk flags",
    accentRgb: "11 125 85", // deep emerald (platform default)
    accentStrongRgb: "10 110 77",
    accentInkRgb: "255 255 255",
    icon: "pulse",
  },
  athlete: {
    role: "athlete",
    label: "Athlete",
    heading: "Train. Log. Recover.",
    subcopy: "Your daily check-in, sessions and recovery in under a minute.",
    tagline: "Check-in & recovery",
    accentRgb: "239 169 78", // light honey amber — soft & premium (dark ink 9.5:1)
    accentStrongRgb: "154 90 12", // deep amber — accent TEXT on light (AA)
    accentInkRgb: "26 12 0",
    icon: "spark",
  },
  guardian: {
    role: "guardian",
    label: "Guardian",
    heading: "Stay in the loop.",
    subcopy: "Follow your athlete's readiness, sessions and coach feedback.",
    tagline: "Follow your athlete",
    accentRgb: "11 110 124", // deepened teal
    accentStrongRgb: "10 94 106",
    accentInkRgb: "255 255 255",
    icon: "heart",
  },
};

export const ROLE_THEME_LIST: RoleTheme[] = [
  ROLE_THEMES.athlete,
  ROLE_THEMES.coach,
  ROLE_THEMES.guardian,
];

/** CSS custom-property overrides for a theme, to spread onto a wrapper's style. */
export function accentVars(theme: RoleTheme): CSSProperties {
  return {
    ["--accent-rgb" as string]: theme.accentRgb,
    ["--accent-strong-rgb" as string]: theme.accentStrongRgb,
    ["--accent-ink-rgb" as string]: theme.accentInkRgb,
    ["--accent-soft" as string]: `rgb(${theme.accentRgb} / 0.16)`,
  } as CSSProperties;
}
