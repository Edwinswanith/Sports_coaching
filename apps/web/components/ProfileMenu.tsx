"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./ui";
import { getStoredUser } from "../lib/api";
import { ROLE_THEMES } from "../lib/roleThemes";
import type { Role } from "../lib/roles";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Single avatar button in the header that opens a menu with everything about the
 * signed-in user — name, email, role — plus Account & password and Sign out.
 * Replaces the separate account/sign-out icons. Closes on outside tap or Escape.
 */
export function ProfileMenu({
  userName,
  role,
  onSignOut,
}: {
  userName?: string;
  role: Role;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [storedName, setStoredName] = useState("");

  useEffect(() => {
    const u = getStoredUser();
    if (u) {
      setEmail(u.email ?? "");
      setStoredName(u.name ?? "");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const name = userName || storedName || "Your account";
  const roleLabel = ROLE_THEMES[role]?.label ?? role;
  const initials = initialsOf(name);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile and account"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-strong ring-1 ring-accent/20 transition hover:brightness-95"
      >
        {initials}
      </button>

      {open ? (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="surface-card absolute right-0 top-full z-40 mt-2 w-60 p-3 shadow-pop">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-strong">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{name}</p>
                {email ? <p className="truncate text-[11px] text-ink-muted">{email}</p> : null}
              </div>
            </div>

            <div className="mt-2">
              <span className="chip border border-line text-ink-muted">{roleLabel}</span>
            </div>

            <div className="mt-3 space-y-1 border-t border-line pt-2">
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-ink transition hover:bg-surface-inset"
              >
                <Icon.key /> Account &amp; password
              </Link>
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-bad transition hover:bg-bad/10"
              >
                <Icon.logout /> Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
