"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./ui";
import { Avatar, type AvatarInfo } from "./Avatar";
import { getStoredUser } from "../lib/api";
import { ROLE_THEMES } from "../lib/roleThemes";
import type { Role } from "../lib/roles";

/**
 * Single avatar button in the header that opens a menu with everything about the
 * signed-in user — name, email, role — plus Account & password and Sign out.
 * Replaces the separate account/sign-out icons. Closes on outside tap or Escape.
 */
export function ProfileMenu({
  userName,
  role,
  onSignOut,
  avatarClassName = "h-9 w-9",
}: {
  userName?: string;
  role: Role;
  onSignOut: () => void;
  /** Override the trigger avatar's size (default matches the header's other icon buttons). */
  avatarClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [storedName, setStoredName] = useState("");
  const [avatar, setAvatar] = useState<AvatarInfo>(undefined);

  useEffect(() => {
    const u = getStoredUser();
    if (u) {
      setEmail(u.email ?? "");
      setStoredName(u.name ?? "");
      setAvatar(u.avatar);
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile and account"
        aria-expanded={open}
        className={`flex items-center justify-center rounded-full ring-1 ring-accent/20 transition hover:brightness-95 ${avatarClassName}`}
      >
        <Avatar avatar={avatar} name={name} className={avatarClassName} />
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
              <Avatar avatar={avatar} name={name} className="h-10 w-10" />
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
