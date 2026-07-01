"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

/**
 * Generic analytics fetch hook. Follows the app's cookie-auth `apiFetch`
 * (credentials + single-flight refresh). Pass `null` to skip (e.g. before an
 * athleteId is known). Re-fetches whenever `path` changes.
 */
export function useSeries<T = unknown>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await apiFetch(path);
        if (!res.ok) {
          if (!cancelled) {
            setError(true);
            setLoading(false);
          }
          return;
        }
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, loading, error };
}
