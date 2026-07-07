"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BottomSheet } from "./BottomSheet";
import { apiFetch } from "../lib/api";

/**
 * Quick check-in — captures Sleep hours + Sleep quality (the two daily
 * wellness fields the "Today" ring's Sleep tile reads from) plus the twice-
 * daily resting heart rate, all saved together by one button (mirrors the
 * mobile app's quick check-in exactly). Everything else (RPE, soreness,
 * fatigue, mood) lives in the full per-session Log form instead.
 */

function wellnessFiveToTen(value: number | null | undefined): number {
  if (value === null || value === undefined) return 5;
  return Math.max(1, Math.min(10, Math.round(1 + ((value - 1) * 9) / 4)));
}

function wellnessTenToFive(value: number): number {
  const clamped = Math.max(1, Math.min(10, value));
  return 1 + ((clamped - 1) * 4) / 9;
}

export function QuickCheckIn({
  open,
  onClose,
  date,
  defaults,
  onSaved,
  hrForm,
  setHrForm,
  submitHeartRate,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  defaults: { sleepHours: number | null; sleepQuality: number | null };
  onSaved: () => void;
  hrForm: { wakeHr: string; bedHr: string };
  setHrForm: Dispatch<SetStateAction<{ wakeHr: string; bedHr: string }>>;
  submitHeartRate: () => Promise<void>;
}) {
  const [sleepHours, setSleepHours] = useState("");
  const [sleepQuality, setSleepQuality] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSleepHours(defaults.sleepHours != null ? String(defaults.sleepHours) : "");
    setSleepQuality(wellnessFiveToTen(defaults.sleepQuality));
    setError(null);
  }, [open, defaults]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/athlete/wellness", {
        method: "POST",
        body: JSON.stringify({
          date,
          sleepHours: sleepHours ? Number(sleepHours) : undefined,
          sleepQuality: wellnessTenToFive(sleepQuality),
        }),
      });
      if (!res.ok) {
        setError("Could not save your check-in.");
        return;
      }
      await submitHeartRate();
      onSaved();
      onClose();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={<p className="font-display text-base font-semibold text-ink">Quick check-in</p>}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">Sleep hours</span>
          <input
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            type="number"
            min={0}
            max={14}
            step={0.5}
            inputMode="decimal"
            placeholder="e.g. 8"
            className="field mt-1.5 nums"
          />
        </label>

        <div>
          <div className="flex justify-between text-xs">
            <span className="font-medium text-ink-muted">Sleep quality</span>
            <span className="nums font-display font-semibold text-accent-strong">{sleepQuality}/10</span>
          </div>
          <input
            value={sleepQuality}
            onChange={(e) => setSleepQuality(Number(e.target.value))}
            type="range"
            min={1}
            max={10}
            step={1}
            aria-label="Sleep quality"
            className="mt-1 w-full"
          />
          <div className="mt-0.5 flex justify-between text-[10px] uppercase tracking-wide text-ink-faint">
            <span>Poor</span>
            <span>Great</span>
          </div>
        </div>

        <label className="block">
          <span className="label">Waking HR</span>
          <input
            value={hrForm.wakeHr}
            onChange={(e) => setHrForm((s) => ({ ...s, wakeHr: e.target.value }))}
            type="number"
            inputMode="numeric"
            min={25}
            max={220}
            placeholder="bpm"
            className="field mt-1.5"
          />
        </label>

        <label className="block">
          <span className="label">Before-bed HR</span>
          <input
            value={hrForm.bedHr}
            onChange={(e) => setHrForm((s) => ({ ...s, bedHr: e.target.value }))}
            type="number"
            inputMode="numeric"
            min={25}
            max={220}
            placeholder="bpm"
            className="field mt-1.5"
          />
        </label>

        {error ? <p className="text-xs text-bad">{error}</p> : null}

        <button onClick={submit} disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Save check-in"}
        </button>
      </div>
    </BottomSheet>
  );
}
