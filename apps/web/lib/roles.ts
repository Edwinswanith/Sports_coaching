// Single source of truth for role → workspace routing.
//
// SECURITY: routing is driven ONLY by the role the server returns from
// /api/auth/login. The login *page* a user starts on (e.g. /login/coach) is
// purely cosmetic and never implies authority — `dashboardPathForRole` is
// always called with the server-returned role, never with anything derived
// from the URL.

export type Role = "coach" | "athlete" | "guardian";

export const ROLES: Role[] = ["coach", "athlete", "guardian"];

export const ROLE_DASHBOARDS: Record<Role, string> = {
  coach: "/coach/dashboard",
  athlete: "/athlete/dashboard",
  guardian: "/guardian/dashboard",
};

/**
 * Maps a (server-returned) role to its dashboard path.
 * Returns null for an unknown/unsupported role so callers can show a graceful
 * "workspace not available yet" message instead of navigating nowhere.
 */
export function dashboardPathForRole(role: string): string | null {
  return (ROLE_DASHBOARDS as Record<string, string>)[role] ?? null;
}

export function isKnownRole(role: string): role is Role {
  return role in ROLE_DASHBOARDS;
}
