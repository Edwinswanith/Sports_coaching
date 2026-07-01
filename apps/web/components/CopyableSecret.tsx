"use client";

import { useState } from "react";

/**
 * Shows a one-time secret (e.g. a temp password) with a copy button.
 * The value is shown once after account creation; the coach hands it off.
 */
export function CopyableSecret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-inset p-3">
      <p className="label">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all font-mono text-sm font-semibold tracking-wide text-ink">
          {value}
        </code>
        <button onClick={copy} className="btn-ghost h-9 shrink-0 px-3 text-xs">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
