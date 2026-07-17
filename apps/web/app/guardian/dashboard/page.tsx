"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, CompactDatePicker } from "../../../components/ui";
import { ProfileMenu } from "../../../components/ProfileMenu";
import { Gauge } from "../../../components/Gauge";
import { AppShell, type NavItem } from "../../../components/AppShell";
import { AskAgentButton, AskAgentSheet, type AskAgentHandle } from "../../../components/AskAgentSheet";
import { useAutoStartTour } from "../../../lib/tour/TourProvider";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../lib/api";

type AthleteSummary = { athleteId: string; name: string; sport: string; position: string | null };

type GuardianSummary = {
  date: string;
  sleep: { quality: number | null; hours: number | null };
  attendance: { status: string | null; note: string | null };
  water: { totalMl: number; goalMl: number };
};

type Band = "green" | "amber" | "red" | "neutral";

const BAND_STYLE: Record<Band, { badge: string; fill: string; ring: string }> = {
  green: { badge: "bg-ok/10 text-ok", fill: "bg-ok", ring: "ring-ok/15" },
  amber: { badge: "bg-warn/10 text-warn", fill: "bg-warn", ring: "ring-warn/15" },
  red: { badge: "bg-bad/10 text-bad", fill: "bg-bad", ring: "ring-bad/15" },
  neutral: { badge: "bg-surface-inset text-ink-faint", fill: "bg-line-strong", ring: "ring-line" },
};

function litres(ml: number) {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function sleepBand(quality: number | null): Band {
  if (quality === null) return "neutral";
  if (quality <= 2) return "red";
  if (quality === 3) return "amber";
  return "green";
}

function sleepLabel(quality: number | null): string {
  if (quality === null) return "No check-in yet";
  return ["", "Poor", "Fair", "Good", "Great", "Excellent"][quality] ?? "—";
}

function waterBand(pct: number, hasGoal: boolean): Band {
  if (!hasGoal) return "neutral";
  if (pct >= 90) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

function attendanceBand(status: string | null): Band {
  if (status === null) return "neutral";
  if (status === "present" || status === "rest") return "green";
  if (status === "late" || status === "excused") return "amber";
  return "red";
}

function attendanceLabel(status: string | null) {
  if (status === null) return "Not logged";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "GU";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Guardian dashboard — deliberately narrow. Guardians may see ONLY three
 * data points for their linked athlete: Sleep quality, Water intake, and
 * Attendance for a given day. No readiness, training load, injuries, coach
 * feedback, or messages — see server/src/routes/guardian.ts for the matching
 * server-side restriction (the API itself never returns anything else).
 */
export default function GuardianDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [athletes, setAthletes] = useState<AthleteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GuardianSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const askAgentRef = useRef<AskAgentHandle>(null);
  const [askAgentInputOpen, setAskAgentInputOpen] = useState(false);
  const [askAgentListening, setAskAgentListening] = useState(false);

  const guard = useCallback(
    (status: number) => {
      if (isAuthFailure(status)) {
        clearSession();
        router.replace("/");
        return true;
      }
      return false;
    },
    [router]
  );

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/guardian/athletes");
        if (guard(res.status)) return;
        const json = (await res.json()) as { athletes?: AthleteSummary[] };
        if (cancelled) return;
        const list = json.athletes ?? [];
        setAthletes(list);
        setSelectedId((prev) => prev ?? list[0]?.athleteId ?? null);
      } catch {
        if (!cancelled) setError("Unable to load linked athletes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, guard]);

  useAutoStartTour("guardian");

  useEffect(() => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await apiFetch(`/api/guardian/athletes/${selectedId}/summary?date=${date}`);
        if (guard(res.status)) return;
        const json = (await res.json()) as GuardianSummary;
        if (cancelled) return;
        setSummary(json);
      } catch {
        if (!cancelled) setError("Unable to load athlete summary.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, date, guard]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const selectedName = athletes.find((a) => a.athleteId === selectedId)?.name ?? "Athlete";
  const nav: NavItem[] = [{ key: "today", label: "Summary", icon: <Icon.home /> }];
  const hasGoal = Boolean(summary && summary.water.goalMl > 0);
  const waterPct = summary && hasGoal ? Math.min(100, Math.round((summary.water.totalMl / summary.water.goalMl) * 100)) : 0;
  const guardianAgentContext = {
    athleteName: selectedName,
    sleepLabel: summary
      ? `${sleepLabel(summary.sleep.quality)}${summary.sleep.hours != null ? `, ${summary.sleep.hours}h logged` : ""}`
      : "No data for this date",
    waterLabel: summary ? `${litres(summary.water.totalMl)} of ${litres(summary.water.goalMl)} L` : "No data for this date",
    attendanceLabel: summary ? attendanceLabel(summary.attendance.status) : "No data for this date",
  };
  const startAskAgentVoice = () => {
    setAskAgentInputOpen(false);
    askAgentRef.current?.startVoice();
  };
  const openAskAgentInput = () => setAskAgentInputOpen(true);

  return (
    <AppShell
      role="guardian"
      title={selectedName}
      userName={user?.name}
      nav={nav}
      activeKey="today"
      onNavigate={() => undefined}
      onSignOut={logout}
      hideProfileMenu
      titleSlot={
        <div className="flex items-center gap-3">
          <ProfileMenu userName={user?.name} role="guardian" onSignOut={logout} avatarClassName="h-[50px] w-[50px] text-base" />
          <div className="min-w-0">
            <p className="label text-accent-strong">Guardian</p>
            <p className="truncate font-display text-lg font-bold leading-tight text-ink">{selectedName}</p>
            <p className="truncate text-[11px] text-ink-muted">Sleep, water &amp; attendance only</p>
          </div>
        </div>
      }
      headerIcon={
        <>
          <AskAgentButton
            active={askAgentListening}
            onVoice={startAskAgentVoice}
            onInput={openAskAgentInput}
            tourId="guardian-ask-agent"
          />
          <CompactDatePicker value={date} onChange={setDate} label="Date" />
        </>
      }
    >
      <div className="space-y-3">
        {error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
        ) : null}

        {/* Linked-athlete switcher — visible when there's more than one. */}
        {athletes.length > 1 ? (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-tour="guardian-switcher">
            {athletes.map((a) => {
              const active = a.athleteId === selectedId;
              return (
                <button
                  key={a.athleteId}
                  onClick={() => setSelectedId(a.athleteId)}
                  className={`flex h-9 shrink-0 items-center gap-2 rounded-full border pl-1.5 pr-3 text-xs font-semibold transition ${
                    active
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line bg-surface-inset text-ink-muted hover:text-ink"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                      active ? "bg-white/25 text-accent-ink" : "bg-accent-soft text-accent-strong"
                    }`}
                  >
                    {initialsOf(a.name)}
                  </span>
                  {a.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <div className="surface-card h-24 animate-pulse" />
            <div className="surface-card h-24 animate-pulse" />
            <div className="surface-card h-24 animate-pulse" />
          </div>
        ) : athletes.length === 0 ? (
          <div className="surface-card p-5 text-center">
            <p className="text-sm text-ink-muted">No linked athletes yet. Ask the academy to link your account.</p>
          </div>
        ) : !summary ? (
          <div className="surface-card p-5 text-center">
            <p className="text-sm text-ink-muted">No data for this date.</p>
          </div>
        ) : (
          <div className="animate-rise space-y-3">
            <div data-tour="guardian-sleep">
              <SleepCard quality={summary.sleep.quality} hours={summary.sleep.hours} />
            </div>
            <div data-tour="guardian-water">
              <WaterCard totalMl={summary.water.totalMl} goalMl={summary.water.goalMl} pct={waterPct} hasGoal={hasGoal} />
            </div>
            <div data-tour="guardian-attendance">
              <AttendanceCard status={summary.attendance.status} note={summary.attendance.note} />
            </div>
          </div>
        )}
      </div>
      <AskAgentSheet
        ref={askAgentRef}
        role="guardian"
        inputOpen={askAgentInputOpen}
        onCloseInput={() => setAskAgentInputOpen(false)}
        onListeningChange={setAskAgentListening}
        guardianContext={guardianAgentContext}
      />
    </AppShell>
  );
}

function MetricIcon({ band, children }: { band: Band; children: React.ReactNode }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-4 ${BAND_STYLE[band].badge} ${BAND_STYLE[band].ring}`}>
      {children}
    </span>
  );
}

function Badge({ band, children }: { band: Band; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${BAND_STYLE[band].badge}`}>
      {children}
    </span>
  );
}

function SleepCard({ quality, hours }: { quality: number | null; hours: number | null }) {
  const band = sleepBand(quality);
  const pct = quality !== null ? (quality / 5) * 100 : 0;
  return (
    <div className="surface-card overflow-hidden p-4">
      <div className="flex items-center gap-4">
        <Gauge pct={pct} band={band} displayValue={quality ?? "—"} displayUnit="/ 5" />
        <div className="min-w-0 flex-1">
          <p className="label text-ink-muted">Sleep quality</p>
          <p className="mt-1 font-display text-base font-bold text-ink">{sleepLabel(quality)}</p>
          {hours != null ? <p className="mt-0.5 text-xs text-ink-muted">{hours}h of sleep logged</p> : null}
        </div>
      </div>
    </div>
  );
}

function WaterCard({
  totalMl,
  goalMl,
  pct,
  hasGoal,
}: {
  totalMl: number;
  goalMl: number;
  pct: number;
  hasGoal: boolean;
}) {
  const band = waterBand(pct, hasGoal);
  return (
    <div className="surface-card overflow-hidden p-4">
      <div className="flex items-center gap-4">
        <Gauge pct={pct} band={band} displayValue={`${pct}%`} />
        <div className="min-w-0 flex-1">
          <p className="label text-ink-muted">Water intake</p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="nums font-display text-base font-bold text-ink">{litres(totalMl)}</span>
            <span className="text-xs text-ink-faint">/ {litres(goalMl)} L goal</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function AttendanceCard({ status, note }: { status: string | null; note: string | null }) {
  const band = attendanceBand(status);
  return (
    <div className="surface-card overflow-hidden p-4">
      <div className="flex items-center gap-4">
        <MetricIcon band={band}>
          <Icon.check />
        </MetricIcon>
        <div className="min-w-0 flex-1">
          <p className="label text-ink-muted">Attendance</p>
          <p className="mt-1 font-display text-base font-bold text-ink">{attendanceLabel(status)}</p>
          {note ? <p className="mt-0.5 truncate text-xs text-ink-muted">{note}</p> : null}
        </div>
        <Badge band={band}>{status ?? "—"}</Badge>
      </div>
    </div>
  );
}
