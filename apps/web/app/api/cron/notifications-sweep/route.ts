import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORWARDED_QUERY_KEYS = ["limit", "pages", "cursor"] as const;

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function sweepUrl(req: NextRequest): string {
  const apiBase = normalizeBaseUrl(
    process.env.SERVER_API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://localhost:4000"
  );
  const url = new URL("/internal/notifications/sweep", apiBase);
  for (const key of FORWARDED_QUERY_KEYS) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const sweepSecret = process.env.INTERNAL_SWEEP_SECRET;

  if (!cronSecret || !sweepSecret) {
    return NextResponse.json(
      { error: "cron_not_configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!constantTimeEquals(auth, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(sweepUrl(req), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sweepSecret}`,
    },
    cache: "no-store",
  });
  const text = await res.text();

  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Keep non-JSON backend responses readable in Vercel function logs.
  }

  return NextResponse.json(
    { ok: res.ok, backendStatus: res.status, result: body },
    { status: res.ok ? 200 : 502 }
  );
}
