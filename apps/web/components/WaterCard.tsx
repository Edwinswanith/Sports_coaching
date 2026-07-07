"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../lib/api";
import { Card } from "./Card";

type Entry = { id: string; amountMl: number; loggedAt: string };
type WaterDay = { date: string; goalMl: number; totalMl: number; entries: Entry[] };
type WaterPoint = { date: string; totalMl: number | null };
type WaterSeries = { days: number; goalMl: number; series: WaterPoint[] };

const QUICK_ADD = [250, 500, 750];
const GOAL_PRESETS = [2000, 2500, 3000, 3500];
const REMINDER_KEY = "scp.hydration.reminders";
type ReminderMinutes = 60 | 90 | 120;

function litres(ml: number): string {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function shortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}-${day}`;
}

function readReminderSettings(): { enabled: boolean; minutes: ReminderMinutes } {
  if (typeof window === "undefined") return { enabled: false, minutes: 120 };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMINDER_KEY) ?? "{}") as {
      enabled?: boolean;
      minutes?: number;
    };
    return {
      enabled: Boolean(parsed.enabled),
      minutes: parsed.minutes === 60 || parsed.minutes === 90 || parsed.minutes === 120 ? parsed.minutes : 120,
    };
  } catch {
    return { enabled: false, minutes: 120 };
  }
}

export function HydrationModule({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [historyDays, setHistoryDays] = useState<7 | 30>(7);
  const [history, setHistory] = useState<WaterSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes>(120);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [reminderError, setReminderError] = useState<string | null>(null);

  const loadDay = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/athlete/water?date=${date}`);
      if (!res.ok) return;
      const next = (await res.json()) as WaterDay;
      setDay(next);
      setGoalDraft(String(next.goalMl));
    } catch {
      /* keep last known */
    }
  }, [date]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/athlete/analytics/water?days=${historyDays}`);
      if (res.ok) setHistory((await res.json()) as WaterSeries);
    } catch {
      /* keep last known */
    }
  }, [historyDays]);

  useEffect(() => {
    const settings = readReminderSettings();
    setRemindersEnabled(settings.enabled);
    setReminderMinutes(settings.minutes);
    setNotificationPermission(
      typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
    );
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REMINDER_KEY,
      JSON.stringify({ enabled: remindersEnabled, minutes: reminderMinutes })
    );
  }, [remindersEnabled, reminderMinutes]);

  useEffect(() => {
    if (!remindersEnabled || notificationPermission !== "granted") return;
    const id = window.setInterval(() => {
      const goal = day?.goalMl ?? 3000;
      const total = day?.totalMl ?? 0;
      const remaining = Math.max(0, goal - total);
      if (remaining <= 0) return;
      new Notification("Hydration reminder", {
        body: `${litres(remaining)} L remaining for today's water goal.`,
      });
    }, reminderMinutes * 60 * 1000);
    return () => window.clearInterval(id);
  }, [day?.goalMl, day?.totalMl, notificationPermission, reminderMinutes, remindersEnabled]);

  async function mutateWater(run: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) {
        setDay((await res.json()) as WaterDay);
        await loadHistory();
      }
    } finally {
      setBusy(false);
    }
  }

  async function add(amountMl: number) {
    setAmountError(null);
    await mutateWater(() =>
      apiFetch("/api/athlete/water", { method: "POST", body: JSON.stringify({ date, amountMl }) })
    );
  }

  async function addCustomAmount() {
    const amountMl = Number(amountDraft);
    if (!Number.isFinite(amountMl) || amountMl < 50 || amountMl > 3000) {
      setAmountError("Amount must be between 50 and 3000 ml.");
      return;
    }
    await add(Math.round(amountMl));
    setAmountDraft("");
  }

  async function remove(id: string) {
    await mutateWater(() => apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" }));
  }

  async function saveGoal(nextGoal?: number) {
    const goalMl = nextGoal ?? Number(goalDraft);
    if (!Number.isFinite(goalMl) || goalMl < 500 || goalMl > 8000) {
      setGoalError("Goal must be between 500 and 8000 ml.");
      return;
    }
    setBusy(true);
    setGoalError(null);
    try {
      const rounded = Math.round(goalMl);
      const res = await apiFetch("/api/athlete/me", {
        method: "PATCH",
        body: JSON.stringify({ hydrationGoalMl: rounded }),
      });
      if (!res.ok) {
        setGoalError("Could not save goal.");
        return;
      }
      setGoalDraft(String(rounded));
      setDay((current) => current ? { ...current, goalMl: rounded } : current);
      await Promise.all([loadDay(), loadHistory()]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReminders() {
    setReminderError(null);
    if (remindersEnabled) {
      setRemindersEnabled(false);
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      setReminderError("Browser notifications are not available here.");
      return;
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setReminderError("Allow browser notifications to use reminders.");
        return;
      }
    }
    if (Notification.permission === "denied") {
      setNotificationPermission("denied");
      setReminderError("Notifications are blocked in this browser.");
      return;
    }
    setNotificationPermission(Notification.permission);
    setRemindersEnabled(true);
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const remaining = Math.max(0, goal - total);
  const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const reached = total >= goal;
  const historyGoal = history?.goalMl ?? goal;
  const achievedDays = useMemo(
    () => (history?.series ?? []).filter((p) => (p.totalMl ?? 0) >= historyGoal).length,
    [history?.series, historyGoal]
  );

  return (
    // Recolor the whole hydration module to the water blue so it matches the
    // mobile app's water screen (overriding the role accent just for this scope
    // cascades to every `var(--accent)` / bg-accent / border-accent below).
    <div
      className="space-y-3 animate-rise"
      style={
        {
          "--accent-rgb": "47 125 246",
          "--accent-strong-rgb": "37 99 235",
          "--accent-ink-rgb": "255 255 255",
        } as CSSProperties
      }
    >
      <Card title="Water goal">
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative grid h-44 w-44 place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--accent) ${pct * 3.6}deg, rgb(var(--surface-inset-rgb)) 0deg)`,
            }}
          >
            <div className="grid h-32 w-32 place-items-center rounded-full bg-surface-raised text-center shadow-sm">
              <div>
                <p className="nums font-display text-3xl font-extrabold text-ink">{pct}%</p>
                <p className="text-[11px] font-semibold text-ink-muted">{reached ? "Goal met" : "Complete"}</p>
              </div>
            </div>
          </div>

          <div className="grid w-full grid-cols-3 gap-2">
            <MetricTile label="Drunk" value={`${litres(total)} L`} />
            <MetricTile label="Remaining" value={`${litres(remaining)} L`} good={reached} />
            <MetricTile label="Goal" value={`${litres(goal)} L`} />
          </div>

          <div className={`w-full rounded-xl border px-3 py-2 ${reached ? "border-ok/30 bg-ok/10" : "border-line bg-surface-inset"}`}>
            <p className={`text-sm font-semibold ${reached ? "text-ok" : "text-ink"}`}>
              {reached ? "Daily hydration achieved" : `${remaining} ml remaining today`}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {achievedDays} of last {historyDays} days reached the goal.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Daily water goal">
        <div className="grid grid-cols-4 gap-2">
          {GOAL_PRESETS.map((ml) => (
            <button
              key={ml}
              onClick={() => void saveGoal(ml)}
              disabled={busy}
              className={`h-10 rounded-xl border text-xs font-semibold transition ${
                goal === ml
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface-inset text-ink-muted hover:text-ink"
              }`}
            >
              {litres(ml)} L
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={goalDraft}
            onChange={(e) => setGoalDraft(e.target.value)}
            type="number"
            inputMode="numeric"
            min={500}
            max={8000}
            step={50}
            className="field nums"
          />
          <button onClick={() => void saveGoal()} disabled={busy} className="btn-primary h-11 shrink-0 px-4">
            Save
          </button>
        </div>
        {goalError ? <p className="mt-2 text-[11px] font-semibold text-bad">{goalError}</p> : null}
      </Card>

      <Card title="Log water intake">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_ADD.map((ml) => (
            <button key={ml} onClick={() => void add(ml)} disabled={busy} className="btn-secondary">
              +{ml} ml
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            type="number"
            inputMode="numeric"
            min={50}
            max={3000}
            step={50}
            placeholder="Custom ml"
            className="field nums"
          />
          <button onClick={() => void addCustomAmount()} disabled={busy || !amountDraft.trim()} className="btn-primary h-11 shrink-0 px-4">
            Add
          </button>
        </div>
        {amountError ? <p className="mt-2 text-[11px] font-semibold text-bad">{amountError}</p> : null}
      </Card>

      <Card title="Reminder notifications">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Hydration reminders</p>
            <p className="text-[11px] text-ink-muted">
              {remindersEnabled ? `Every ${reminderMinutes} minutes while this app is open.` : "Off"}
            </p>
          </div>
          <button
            onClick={() => void toggleReminders()}
            className={`h-9 rounded-full border px-3 text-xs font-semibold transition ${
              remindersEnabled
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-inset text-ink-muted hover:text-ink"
            }`}
          >
            {remindersEnabled ? "On" : "Enable"}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[60, 90, 120].map((minutes) => (
            <button
              key={minutes}
              onClick={() => setReminderMinutes(minutes as 60 | 90 | 120)}
              className={`h-9 rounded-xl border text-xs font-semibold transition ${
                reminderMinutes === minutes
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface-inset text-ink-muted hover:text-ink"
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Status: {notificationPermission === "unsupported" ? "unsupported" : notificationPermission}
        </p>
        {reminderError ? <p className="mt-2 text-[11px] font-semibold text-bad">{reminderError}</p> : null}
      </Card>

      <Card
        title={historyDays === 7 ? "Weekly chart" : "Monthly chart"}
        action={
          <div className="seg">
            {[7, 30].map((days) => (
              <button
                key={days}
                onClick={() => setHistoryDays(days as 7 | 30)}
                className={`seg-btn ${historyDays === days ? "seg-btn--active" : ""}`}
              >
                {days === 7 ? "Week" : "Month"}
              </button>
            ))}
          </div>
        }
      >
        <HydrationBars series={history?.series ?? []} goalMl={historyGoal} />
      </Card>

      <Card title="Hydration history">
        {history && history.series.length > 0 ? (
          <ul className="divide-y divide-line">
            {[...history.series].reverse().slice(0, 10).map((point) => {
              const amount = point.totalMl ?? 0;
              const met = amount >= historyGoal;
              return (
                <li key={point.date} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-ink">{shortDate(point.date)}</p>
                    <p className="text-[11px] text-ink-muted">{met ? "Goal achieved" : `${Math.max(0, historyGoal - amount)} ml remaining`}</p>
                  </div>
                  <p className={`nums font-display text-base font-bold ${met ? "text-ok" : "text-ink"}`}>
                    {litres(amount)} L
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">No hydration history yet.</p>
        )}
      </Card>

      <Card title="Today's entries">
        {day && day.entries.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {[...day.entries].reverse().map((entry) => (
              <button
                key={entry.id}
                onClick={() => void remove(entry.id)}
                disabled={busy}
                title="Tap to remove"
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-inset px-2 py-1 text-[11px] text-ink-muted transition hover:border-bad/40 hover:text-bad"
              >
                {entry.amountMl} ml <span aria-hidden>x</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-faint">No water logged for this date.</p>
        )}
      </Card>
    </div>
  );
}

function MetricTile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-inset p-3">
      <p className="label">{label}</p>
      <p className={`nums mt-1 font-display text-lg font-bold ${good ? "text-ok" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function HydrationBars({ series, goalMl }: { series: WaterPoint[]; goalMl: number }) {
  const max = Math.max(goalMl, ...series.map((point) => point.totalMl ?? 0), 1) * 1.12;
  if (series.length === 0) return <p className="text-xs text-ink-faint">No chart data yet.</p>;

  const data = series.map((point) => {
    const total = point.totalMl ?? 0;
    return {
      date: point.date,
      amount: total,
      label: shortDate(point.date),
      met: total >= goalMl,
      missing: point.totalMl === null,
    };
  });

  return (
    <div>
      <div className="h-44 border-b border-line">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="waterArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={[0, max]} />
            {/* Dashed goal line — days above it hit the target. */}
            <ReferenceLine y={goalMl} stroke="var(--ok)" strokeDasharray="4 4" strokeOpacity={0.75} />
            <Tooltip
              cursor={{ stroke: "rgb(var(--accent-rgb) / 0.4)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[11px] shadow-pop">
                    <p className="font-semibold text-ink">{item.date}</p>
                    <p className="mt-0.5 text-ink-muted">
                      {item.amount} ml{item.met ? " · goal met" : ""}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke="var(--accent)"
              strokeWidth={2.5}
              fill="url(#waterArea)"
              dot={{ r: 3, stroke: "var(--accent)", strokeWidth: 2, fill: "var(--surface-raised)" }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex justify-between gap-1 text-[10px] text-ink-faint">
        <span>{shortDate(series[0].date)}</span>
        <span>Goal {litres(goalMl)} L</span>
        <span>{shortDate(series[series.length - 1].date)}</span>
      </div>
    </div>
  );
}
