"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "../../../../components/Card";
import { Icon } from "../../../../components/ui";
import { AppShell } from "../../../../components/AppShell";
import { coachNav, coachNavigate } from "../../../../lib/coachNav";
import { CopyableSecret } from "../../../../components/CopyableSecret";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../../lib/api";

type CreatedAthlete = {
  athleteId: string;
  userId: string;
  name: string;
  email: string;
  sport: string;
  position: string | null;
  timezone?: string;
};

/** Success payload for either path: a fresh account (with temp password) or an
 * existing athlete linked in (no password — they already have their own). */
type AthleteResult = { athlete: CreatedAthlete; tempPassword?: string };

type AddMode = "create" | "link";

type CreatedGuardian = {
  guardian: { userId: string; name: string; email: string };
  relationship: string | null;
  linkedExisting: boolean;
  tempPassword?: string;
};

const ERROR_COPY: Record<string, string> = {
  email_already_exists: "That email is already registered to another account.",
  already_linked: "That guardian is already linked to this athlete.",
  invalid_name: "Please enter a name.",
  invalid_email: "Please enter a valid email address.",
  invalid_sport: "Please enter a sport.",
  too_many_requests: "Too many requests — wait a moment and try again.",
};

// Errors specific to the "link existing" path.
const LINK_ERROR_COPY: Record<string, string> = {
  athlete_not_found: "No athlete account uses that email. Check it, or create a new athlete instead.",
  already_linked: "That athlete is already on your squad.",
  invalid_email: "Please enter a valid email address.",
};

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function NewAthletePage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
  }, [router]);

  // create | link — two ways to add an athlete to the squad.
  const [mode, setMode] = useState<AddMode>("create");

  // Athlete form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  // Link-existing form
  const [linkEmail, setLinkEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AthleteResult | null>(null);

  function authGuard(httpStatus: number): boolean {
    if (isAuthFailure(httpStatus)) {
      clearSession();
      router.replace("/");
      return true;
    }
    return false;
  }

  async function submitAthlete(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await apiFetch("/api/coach/athletes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          sport: sport.trim(),
          position: position.trim() || undefined,
          timezone: timezone.trim() || undefined,
        }),
      });
      if (authGuard(res.status)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(ERROR_COPY[json?.error] ?? "Could not create the athlete. Please try again.");
        return;
      }
      setCreated({ athlete: json.athlete, tempPassword: json.tempPassword });
      setStatus("idle");
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  async function submitLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await apiFetch("/api/coach/athletes/link", {
        method: "POST",
        body: JSON.stringify({ email: linkEmail.trim() }),
      });
      if (authGuard(res.status)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(LINK_ERROR_COPY[json?.error] ?? "Could not link the athlete. Please try again.");
        return;
      }
      // No temp password — the athlete keeps their own credentials.
      setCreated({ athlete: json.athlete });
      setStatus("idle");
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  function resetForAnother() {
    setCreated(null);
    setName("");
    setEmail("");
    setSport("");
    setPosition("");
    setLinkEmail("");
    setStatus("idle");
    setError(null);
  }

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = coachNav(user?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  return (
    <AppShell
      role="coach"
      title="Add athlete"
      subtitle={created ? "Athlete added to your squad" : "Create a new account or link an existing athlete"}
      userName={user?.name}
      nav={nav}
      activeKey="roster"
      onNavigate={navigate}
      onSignOut={logout}
    >
      <section className="space-y-4">
        {!created ? (
          <Card title={mode === "create" ? "New athlete" : "Link existing athlete"}>
            <ModeToggle
              mode={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
                setStatus("idle");
              }}
            />

            {mode === "create" ? (
              <form onSubmit={submitAthlete} className="grid gap-3">
                <Field label="Full name" value={name} onChange={setName} placeholder="e.g. Arjun Rao" required autoFocus />
                <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="athlete@email.com" required />
                <Field label="Sport" value={sport} onChange={setSport} placeholder="e.g. athletics" required list="sport-options" />
                <datalist id="sport-options">
                  {["athletics", "football", "cricket", "basketball", "swimming", "tennis", "badminton", "hockey"].map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="e.g. sprinter" />
                <Field label="Timezone" value={timezone} onChange={setTimezone} placeholder="e.g. Asia/Kolkata" />

                {error ? (
                  <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
                ) : null}

                <button type="submit" disabled={status === "saving"} className="btn-primary mt-1 w-full">
                  {status === "saving" ? "Creating…" : "Create athlete"}
                </button>
              </form>
            ) : (
              <form onSubmit={submitLink} className="grid gap-3">
                <p className="text-sm text-ink-muted">
                  Already signed up themselves? Add them to your squad by the email they registered with — no new password needed.
                </p>
                <Field
                  label="Athlete's email"
                  value={linkEmail}
                  onChange={setLinkEmail}
                  type="email"
                  placeholder="athlete@email.com"
                  required
                  autoFocus
                />

                {error ? (
                  <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
                ) : null}

                <button type="submit" disabled={status === "saving"} className="btn-primary mt-1 w-full">
                  {status === "saving" ? "Linking…" : "Link to my squad"}
                </button>
              </form>
            )}
          </Card>
        ) : (
          <AthleteCreated created={created} authGuard={authGuard} onAddAnother={resetForAnother} />
        )}
      </section>
    </AppShell>
  );
}

function ModeToggle({ mode, onChange }: { mode: AddMode; onChange: (m: AddMode) => void }) {
  const tab = (m: AddMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={mode === m}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
        mode === m ? "bg-accent text-accent-ink shadow-sm" : "text-ink-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="mb-4 flex gap-1 rounded-xl bg-surface-inset p-1">
      {tab("create", "Create new")}
      {tab("link", "Link existing")}
    </div>
  );
}

function AthleteCreated({
  created,
  authGuard,
  onAddAnother,
}: {
  created: AthleteResult;
  authGuard: (status: number) => boolean;
  onAddAnother: () => void;
}) {
  const { athlete, tempPassword } = created;
  return (
    <>
      <Card title={`${athlete.name} added`}>
        {tempPassword ? (
          <>
            <p className="text-sm text-ink-muted">
              {athlete.name} ({athlete.sport}
              {athlete.position ? ` · ${athlete.position}` : ""}) is now on your squad. Share these sign-in details — they
              can log in as an athlete right away.
            </p>
            <div className="mt-3 space-y-2">
              <CopyableSecret label="Email" value={athlete.email} />
              <CopyableSecret label="Temporary password" value={tempPassword} />
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">Shown once — copy it now.</p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            {athlete.name} ({athlete.sport}
            {athlete.position ? ` · ${athlete.position}` : ""}) is now on your squad. They keep their own sign-in — no new
            password needed.
          </p>
        )}
      </Card>

      <AddGuardianForm athleteId={athlete.athleteId} athleteName={athlete.name} authGuard={authGuard} />

      <div className="flex flex-wrap gap-2">
        <Link href={`/coach/athletes/${athlete.athleteId}`} className="btn-primary flex-1 justify-center">
          View athlete
        </Link>
        <button onClick={onAddAnother} className="btn-secondary flex-1 justify-center">
          Add another athlete
        </button>
      </div>
    </>
  );
}

function AddGuardianForm({
  athleteId,
  athleteName,
  authGuard,
}: {
  athleteId: string;
  athleteName: string;
  authGuard: (status: number) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedGuardian | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/guardians`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          relationship: relationship.trim() || undefined,
        }),
      });
      if (authGuard(res.status)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(ERROR_COPY[json?.error] ?? "Could not add the guardian. Please try again.");
        return;
      }
      setResult(json as CreatedGuardian);
      setStatus("idle");
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  if (result) {
    return (
      <Card title="Guardian linked">
        <p className="text-sm text-ink-muted">
          {result.guardian.name} can now follow {athleteName}
          {result.relationship ? ` (${result.relationship})` : ""}.
          {result.linkedExisting ? " They already had an account, so no new password was created." : ""}
        </p>
        {result.tempPassword ? (
          <div className="mt-3 space-y-2">
            <CopyableSecret label="Guardian email" value={result.guardian.email} />
            <CopyableSecret label="Temporary password" value={result.tempPassword} />
          </div>
        ) : null}
      </Card>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary w-full justify-center">
        + Add a guardian for {athleteName}
      </button>
    );
  }

  return (
    <Card title={`Add guardian for ${athleteName}`}>
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Guardian name" value={name} onChange={setName} placeholder="e.g. Mr. Rao" required autoFocus />
        <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="parent@email.com" required />
        <Field label="Relationship (optional)" value={relationship} onChange={setRelationship} placeholder="e.g. father" />
        {error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{error}</div>
        ) : null}
        <button type="submit" disabled={status === "saving"} className="btn-primary w-full">
          {status === "saving" ? "Adding…" : "Add guardian"}
        </button>
      </form>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  autoFocus,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        list={list}
        className="field mt-1.5"
      />
    </label>
  );
}
