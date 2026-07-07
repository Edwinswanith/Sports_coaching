"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

/** Fetches a private, cookie-authenticated file and renders it as an <img> via a blob URL. */
export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const res = await apiFetch(src);
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!url) return <div className={`animate-pulse rounded-lg bg-surface-inset ${className ?? ""}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset Next can optimize
  return <img src={url} alt={alt} className={className} />;
}
