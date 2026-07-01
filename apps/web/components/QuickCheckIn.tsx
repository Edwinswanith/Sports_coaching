"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { apiFetch } from "../lib/api";
import { TRAINING_CATEGORIES } from "../lib/trainingCategories";

/**
 * 30-second daily check-in. Captures the minimum that produces a meaningful
 * readiness score (sleep + 3 wellness sliders) plus an optional one-tap effort
 * rating that derives a training-load entry. Everything else (mood, stress, the
 * full RPE form, recovery modalities) stays available in the detailed Log tab —
 * this is the fast path that gets people to log every day.
 */

type Effort = "rest" | "easy" | "moderate" | "hard" | "max";

const EFFORTS: { key: Effort; label: string; rpe: number | null; intensity: number | null }[] = [
  { key: "rest", label: "Rest", rpe: null, intensity: null },
  { key: "easy", label: "Easy", rpe: 3, intensity: 50 },
  { key: "moderate", label: "Moderate", rpe: 5, intensity: 70 },
  { key: "hard", label: "Hard", rpe: 7, intensity: 85 },
  { key: "max", label: "All-out", rpe: 9, intensity: 95 },
];

const DEFAULT_CATEGORY = "GENERAL STRENGTH & MOBILITY";

function wellnessFiveToTen(value: number | null | undefined): number {
  if (value === null || value === undefined) return 5;
  return Math.max(1, Math.min(10, Math.round(1 + ((value - 1) * 9) / 4)));
}

function wellnessTenToFive(value: number): number {
  const clamped = Math.max(1, Math.min(10, value));
  return 1 + ((clamped - 1) * 4) / 9;
}

export type QuickDefaults = {
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  /** Today's planned AM type — used as the RPE category if it's a known one. */
  plannedType: string | null;
};

export function QuickCheckIn({
  open,
  onClose,
  date,
  defaults,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  defaults: QuickDefaults;
  onSaved: () => void;
}) {
  const [sleepHours, setSleepHours] = useState("");
  const [sleepQuality, setSleepQuality] = useState(5);
  const [soreness, setSoreness] = useState(5);
  const [fatigue, setFatigue] = useState(5);
  const [effort, setEffort] = useState<Effort>("moderate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from whatever was logged today so re-checking-in starts where they left off.
  useEffect(() => {
    if (!open) return;
    setSleepHours(defaults.sleepHours != null ? String(defaults.sleepHours) : "");
    setSleepQuality(wellnessFiveToTen(defaults.sleepQuality));
    setSoreness(wellnessFiveToTen(defaults.soreness));
    setFatigue(5);
    setEffort("moderate");
    setError(null);
  }, [open, defaults]);

  // Live readiness preview — mirrors the server's computeReadiness for the three
  // fields we capture (sleepQuality positive; soreness + fatigue inverted).
  const preview = Math.round(
    (((sleepQuality - 1) / 9) * 100 + ((10 - soreness) / 9) * 100 + ((10 - fatigue) / 9) * 100) / 3
  );
  const previewColor =
    preview >= 80 ? "text-ok" : preview >= 60 ? "text-warn" : "text-bad";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const wellnessRes = await apiFetch("/api/athlete/wellness", {
        method: "POST",
        body: JSON.stringify({
          date,
          sleepHours: sleepHours ? Number(sleepHours) : undefined,
          sleepQuality: wellnessTenToFive(sleepQuality),
          soreness: wellnessTenToFive(soreness),
          fatigue: wellnessTenToFive(fatigue),
        }),
      });
      if (!wellnessRes.ok) {
        setError("Could not save your check-in.");
        return;
      }

      const chosen = EFFORTS.find((e) => e.key === effort);
      if (chosen && chosen.rpe !== null && chosen.intensity !== null) {
        const category =
          defaults.plannedType && (TRAINING_CATEGORIES as readonly string[]).includes(defaults.plannedType)
            ? defaults.plannedType
            : DEFAULT_CATEGORY;
        // Non-fatal: if the load entry fails, the wellness check-in still counts.
        await apiFetch("/api/athlete/rpe-monitoring", {
          method: "POST",
          body: JSON.stringify({
            date,
            sessionType: "AM",
            trainingCategory: category,
            plannedIntensityPercent: chosen.intensity,
            rpe: chosen.rpe,
            sleepQuality: wellnessTenToFive(sleepQuality),
            muscleSoreness: wellnessTenToFive(soreness),
            fatigue: wellnessTenToFive(fatigue),
            moodMotivation: 3,
          }),
        }).catch(() => undefined);
      }

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
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-inset px-4 py-3">
          <div>
            <p className="label">Today's readiness</p>
            <p className="text-[11px] text-ink-muted">Updates as you slide</p>
          </div>
          <span className={`nums font-display text-3xl font-bold ${previewColor}`}>{preview}</span>
        </div>

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

        <QuickSlider label="Sleep quality" lo="Poor" hi="Great" value={sleepQuality} onChange={setSleepQuality} />
        <QuickSlider label="Soreness" lo="Fresh" hi="Sore" value={soreness} onChange={setSoreness} invert />
        <QuickSlider label="Fatigue" lo="Rested" hi="Spent" value={fatigue} onChange={setFatigue} invert />

        <div>
          <span className="label">Did you train? How hard?</span>
          <div className="mt-1.5 grid grid-cols-5 gap-1.5">
            {EFFORTS.map((e) => (
              <button
                key={e.key}
                onClick={() => setEffort(e.key)}
                className={`h-11 rounded-xl border text-[11px] font-semibold transition ${
                  effort === e.key
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line bg-surface-inset text-ink-muted hover:text-ink"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          {effort !== "rest" ? (
            <p className="mt-1.5 text-[11px] text-ink-faint">We'll log a training-load entry from this.</p>
          ) : null}
        </div>

        {error ? <p className="text-xs text-bad">{error}</p> : null}

        <button onClick={submit} disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Save check-in"}
        </button>
      </div>
    </BottomSheet>
  );
}

function QuickSlider({
  label,
  lo,
  hi,
  value,
  onChange,
  invert,
}: {
  label: string;
  lo: string;
  hi: string;
  value: number;
  onChange: (v: number) => void;
  invert?: boolean;
}) {
  const severity = invert ? value : 11 - value; // 10 = worst, 1 = best
  const tone = severity >= 9 ? "var(--bad)" : severity >= 7 ? "var(--warn)" : "var(--accent)";
  const valueColor = severity >= 9 ? "text-bad" : severity >= 7 ? "text-warn" : "text-accent-strong";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="font-medium text-ink-muted">{label}</span>
        <span className={`nums font-display font-semibold ${valueColor}`}>{value}/10</span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        type="range"
        min={1}
        max={10}
        step={1}
        aria-label={label}
        style={{ accentColor: tone }}
        className="mt-1 w-full"
      />
      <div className="mt-0.5 flex justify-between text-[10px] uppercase tracking-wide text-ink-faint">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}
