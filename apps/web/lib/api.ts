// Cookie-based API client.
//
// Auth relies on the httpOnly `accessToken` cookie the server sets at login /
// refresh — the access token is never stored in JS-readable storage, so it is
// not exposed to XSS. Only the non-sensitive user profile is kept in
// localStorage, purely for role routing and header display.

export const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

export type StoredUser = {
  id?: string;
  name: string;
  email: string;
  role: string;
  /** True when the account still uses a coach-issued temp password. */
  mustChangePassword?: boolean;
  /** Coach who can also create/list other coaches in their academy. */
  isAcademyOwner?: boolean;
};

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("scp.user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser): void {
  window.localStorage.setItem("scp.user", JSON.stringify(user));
}

export function clearSession(): void {
  window.localStorage.removeItem("scp.user");
  // Remove any token persisted by an older build (defense-in-depth cleanup).
  window.localStorage.removeItem("scp.accessToken");
}

// Single-flight refresh so a burst of parallel 401s triggers one refresh call.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * Fetch wrapper that always sends cookies, sets a JSON content-type for bodies,
 * and transparently retries once after refreshing the access token on a 401.
 * Returns the (possibly still-401/403) Response — callers decide how to react,
 * typically via `isAuthFailure`.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const opts: RequestInit = {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  };

  let res = await fetch(apiUrl(path), opts);
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetch(apiUrl(path), opts);
    }
  }
  return res;
}

export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

export async function logout(): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);
  clearSession();
}
