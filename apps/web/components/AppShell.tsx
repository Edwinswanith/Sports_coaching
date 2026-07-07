"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ROLE_THEMES, accentVars } from "../lib/roleThemes";
import type { Role } from "../lib/roles";
import { getStoredUser } from "../lib/api";
import { NotificationCenter } from "./NotificationCenter";
import { ProfileMenu } from "./ProfileMenu";

export type NavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  /** Optional attention badge (e.g. needs-attention / unassigned count). */
  badge?: number;
};

type ShellProps = {
  role: Role;
  title: string;
  subtitle?: string;
  userName?: string;
  nav: NavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  /** Right-aligned header controls, in their own row below the title. */
  headerActions?: ReactNode;
  /** Compact icon-sized control rendered inline with the bell/avatar (e.g. a date-picker icon button). */
  headerIcon?: ReactNode;
  /** Full override for the label/title/subtitle block (e.g. an avatar + greeting). */
  titleSlot?: ReactNode;
  /** Hide the default right-side profile avatar — use when titleSlot already renders its own profile menu. */
  hideProfileMenu?: boolean;
  onSignOut: () => void;
  children: ReactNode;
};

/** Mobile-only app frame: a sticky-header + bottom-tab column, applying the
 *  per-role accent across all controls. The column fills phones edge-to-edge
 *  (max-w-md); on wider screens (tablets) it centers as an intentional app
 *  surface on a tinted canvas — never stretched, never awkward empty margins. */
export function AppShell({
  role,
  title,
  subtitle,
  userName,
  nav,
  activeKey,
  onNavigate,
  headerActions,
  headerIcon,
  titleSlot,
  hideProfileMenu,
  onSignOut,
  children,
}: ShellProps) {
  const style = accentVars(ROLE_THEMES[role]);
  const roleLabel = ROLE_THEMES[role].label;

  // Nudge accounts still on a coach-issued temp password to set their own.
  const [mustChangePassword, setMustChangePassword] = useState(false);
  useEffect(() => {
    setMustChangePassword(Boolean(getStoredUser()?.mustChangePassword));
  }, []);

  return (
    <div className="flex min-h-[100dvh] w-full justify-center">
      <div
        id="app-shell"
        style={style}
        className="relative flex min-h-[100dvh] w-full max-w-md flex-col bg-surface shadow-[0_0_60px_-24px_rgba(15,23,42,0.35)]"
      >
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {titleSlot ?? (
                <>
                  <p className="label text-accent-strong">{roleLabel}</p>
                  <h1 className="truncate font-display text-lg font-bold leading-tight text-ink">{title}</h1>
                  {subtitle ? <p className="truncate text-[11px] text-ink-muted">{subtitle}</p> : null}
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationCenter />
              {headerIcon}
              {hideProfileMenu ? null : <ProfileMenu userName={userName} role={role} onSignOut={onSignOut} />}
            </div>
          </div>
          {headerActions ? (
            <div className="flex flex-wrap items-center gap-2">
            {headerActions}
            </div>
          ) : null}
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        {mustChangePassword ? (
          <Link
            href="/account"
            className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm text-warn"
          >
            <span>You're using a temporary password — set your own.</span>
            <span className="shrink-0 font-semibold underline">Update</span>
          </Link>
        ) : null}
        {children}
      </main>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-20 flex justify-center">
        <ul className="flex w-full max-w-md items-stretch gap-1 border-t border-line bg-surface-raised/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
          {nav.map((item) => {
            const active = item.key === activeKey;
            return (
              <li key={item.key} className="flex flex-1">
                <button
                  onClick={() => onNavigate(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={`tab-item ${active ? "tab-item--active" : ""}`}
                >
                  <span
                    className={`relative flex h-7 w-12 items-center justify-center rounded-lg transition ${
                      active ? "bg-accent-soft text-accent-strong" : "text-ink-faint"
                    }`}
                  >
                    {item.icon}
                    {item.badge ? (
                      <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      </div>
    </div>
  );
}

/** Small reusable segmented control (date ranges, section sub-tabs). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  format,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          aria-pressed={o === value}
          className={`seg-btn ${o === value ? "seg-btn--active" : ""}`}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}
