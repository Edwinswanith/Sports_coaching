"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./ui";

/**
 * Mobile bottom sheet — slides up from the bottom, dims the page behind it, and
 * closes on backdrop tap or Escape. Body scroll is locked while open so the
 * sheet content scrolls independently. Constrained to the app column (max-w-md)
 * so it lines up with the rest of the mobile shell.
 *
 * Children mount only while `open` is true, so any data-fetching inside the
 * sheet is lazy by construction (it never runs for unopened rows).
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative mx-auto flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border border-line bg-surface-raised shadow-hero animate-sheet-up"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 pb-3 pt-3">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close" className="btn-ghost h-8 w-8 shrink-0 px-0">
            <Icon.x />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
