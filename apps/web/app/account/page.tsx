"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../components/Card";
import { Icon } from "../../components/ui";
import { PasswordInput } from "../../components/PasswordInput";
import { AppShell, type NavItem } from "../../components/AppShell";
import {
  apiFetch,
  getStoredUser,
  setStoredUser,
  logout as apiLogout,
  type StoredUser,
} from "../../lib/api";
import { dashboardPathForRole, type Role } from "../../lib/roles";

const ERROR_COPY: Record<string, string> = {
  invalid_current_password: "Your current password is incorrect.",
  weak_password: "New password must be at least 8 characters.",
  same_password: "New password must be different from the current one.",
};

const PROFILE_ERROR_COPY: Record<string, string> = {
  invalid_name: "Enter your full name.",
  invalid_sport: "Enter your sport.",
  invalid_position: "Position is too long.",
  invalid_timezone: "Enter a valid timezone.",
  invalid_heightCm: "Height must be between 50 and 250 cm.",
  invalid_weightKg: "Weight must be between 20 and 250 kg.",
  invalid_hydrationGoalMl: "Hydration goal must be between 500 and 8000 ml.",
  invalid_dob: "Enter a valid birth date.",
};

type AthleteProfile = {
  name: string;
  email: string;
  sport: string;
  position: string | null;
  dob: string | null;
  heightCm: number | null;
  weightKg: number | null;
  timezone: string;
  hydrationGoalMl: number;
};

type AthleteProfileForm = {
  name: string;
  email: string;
  sport: string;
  position: string;
  dob: string;
  heightCm: string;
  weightKg: string;
  timezone: string;
  hydrationGoalMl: string;
};

function toProfileForm(athlete: AthleteProfile): AthleteProfileForm {
  return {
    name: athlete.name ?? "",
    email: athlete.email ?? "",
    sport: athlete.sport ?? "",
    position: athlete.position ?? "",
    dob: athlete.dob ?? "",
    heightCm: athlete.heightCm == null ? "" : String(athlete.heightCm),
    weightKg: athlete.weightKg == null ? "" : String(athlete.weightKg),
    timezone: athlete.timezone ?? "UTC",
    hydrationGoalMl: String(athlete.hydrationGoalMl ?? 3000),
  };
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [profileForm, setProfileForm] = useState<AthleteProfileForm | null>(null);
  const [profileStatus, setProfileStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    if (stored.role !== "athlete") return;

    let cancelled = false;
    setProfileStatus("loading");
    setProfileError(null);
    apiFetch("/api/athlete/me")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { athlete?: AthleteProfile };
        if (!res.ok || !json.athlete) throw new Error("profile_load_failed");
        if (!cancelled) {
          setProfileForm(toProfileForm(json.athlete));
          setProfileStatus("idle");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfileStatus("error");
          setProfileError("Could not load your athlete profile.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dashboardPath = useMemo(
    () => (user ? dashboardPathForRole(user.role as Role) : null),
    [user]
  );

  const localError = useMemo(() => {
    if (next && next.length < 8) return "New password must be at least 8 characters.";
    if (confirm && next !== confirm) return "Passwords don't match.";
    return null;
  }, [next, confirm]);

  function setProfileField(key: keyof AthleteProfileForm, value: string) {
    setProfileForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profileForm || !user) return;
    setProfileStatus("saving");
    setProfileError(null);
    try {
      const res = await apiFetch("/api/athlete/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: profileForm.name,
          sport: profileForm.sport,
          position: profileForm.position || null,
          dob: profileForm.dob || null,
          heightCm: optionalNumber(profileForm.heightCm),
          weightKg: optionalNumber(profileForm.weightKg),
          timezone: profileForm.timezone || "UTC",
          hydrationGoalMl: optionalNumber(profileForm.hydrationGoalMl),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        athlete?: AthleteProfile;
        error?: string;
      };
      if (!res.ok || !json.athlete) {
        setProfileStatus("error");
        setProfileError(PROFILE_ERROR_COPY[json?.error ?? ""] ?? "Could not update your profile.");
        return;
      }
      setProfileForm(toProfileForm(json.athlete));
      const updatedUser = { ...user, name: json.athlete.name };
      setUser(updatedUser);
      setStoredUser(updatedUser);
      setProfileStatus("saved");
    } catch {
      setProfileStatus("error");
      setProfileError("Network error - please try again.");
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (localError) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(ERROR_COPY[json?.error] ?? "Could not update your password. Please try again.");
        return;
      }
      if (json?.user) setStoredUser(json.user as StoredUser);
      setStatus("saved");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setStatus("error");
      setError("Network error - please try again.");
    }
  }

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav: NavItem[] = [{ key: "dashboard", label: "Dashboard", icon: <Icon.home /> }];
  function navigate(key: string) {
    if (key === "dashboard" && dashboardPath) router.push(dashboardPath);
  }

  if (!user) return null;

  return (
    <AppShell
      role={user.role as Role}
      title="Account"
      subtitle={user.role === "athlete" ? "Manage profile and sign-in" : "Manage your sign-in"}
      userName={user.name}
      nav={nav}
      activeKey="dashboard"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        {user.role === "athlete" ? (
          <Card title="Athlete profile">
            {profileStatus === "loading" ? (
              <p className="text-sm text-ink-muted">Loading profile...</p>
            ) : profileForm ? (
              <form onSubmit={submitProfile} className="grid gap-3">
                <ProfileField label="Name" value={profileForm.name} onChange={(v) => setProfileField("name", v)} required />
                <ProfileField label="Email" value={profileForm.email} onChange={() => undefined} type="email" disabled />
                <ProfileField label="Sport" value={profileForm.sport} onChange={(v) => setProfileField("sport", v)} required />
                <ProfileField label="Position / event" value={profileForm.position} onChange={(v) => setProfileField("position", v)} />
                <ProfileField label="Birth date" value={profileForm.dob} onChange={(v) => setProfileField("dob", v)} type="date" />
                <ProfileField label="Timezone" value={profileForm.timezone} onChange={(v) => setProfileField("timezone", v)} required />
                <ProfileField label="Height (cm)" value={profileForm.heightCm} onChange={(v) => setProfileField("heightCm", v)} type="number" min="50" max="250" />
                <ProfileField label="Weight (kg)" value={profileForm.weightKg} onChange={(v) => setProfileField("weightKg", v)} type="number" min="20" max="250" />
                <ProfileField label="Hydration goal (ml)" value={profileForm.hydrationGoalMl} onChange={(v) => setProfileField("hydrationGoalMl", v)} type="number" min="500" max="8000" required />

                {profileError ? (
                  <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">
                    {profileError}
                  </div>
                ) : null}
                {profileStatus === "saved" ? (
                  <div className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm text-ok">
                    Profile updated.
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={
                    profileStatus === "saving" ||
                    !profileForm.name.trim() ||
                    !profileForm.sport.trim() ||
                    !profileForm.timezone.trim() ||
                    !profileForm.hydrationGoalMl.trim()
                  }
                  className="btn-primary mt-1 w-full"
                >
                  {profileStatus === "saving" ? "Saving..." : "Save profile"}
                </button>
              </form>
            ) : profileError ? (
              <p className="text-sm text-bad">{profileError}</p>
            ) : null}
          </Card>
        ) : null}

        <Card title="Change password">
          {status === "saved" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm text-ok">
                Password updated. Use it next time you sign in.
              </div>
              {dashboardPath ? (
                <button onClick={() => router.push(dashboardPath)} className="btn-primary w-full">
                  Back to dashboard
                </button>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-3">
              <Pw label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
              <Pw label="New password" value={next} onChange={setNext} autoComplete="new-password" />
              <Pw label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />

              {localError ? (
                <p className="text-[11px] text-bad">{localError}</p>
              ) : null}
              {error ? (
                <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
              ) : null}

              <button
                type="submit"
                disabled={status === "saving" || !current || !next || !confirm || Boolean(localError)}
                className="btn-primary mt-1 w-full"
              >
                {status === "saving" ? "Updating..." : "Update password"}
              </button>
            </form>
          )}
        </Card>
      </section>
    </AppShell>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        className="field mt-1.5 disabled:opacity-70"
      />
    </label>
  );
}

function Pw({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <PasswordInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        wrapperClassName="mt-1.5"
      />
    </label>
  );
}
