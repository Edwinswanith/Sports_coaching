import Link from "next/link";
import { Icon } from "../components/ui";
import { ROLE_THEME_LIST, accentVars, type IconKey, type RoleTheme } from "../lib/roleThemes";

const ICONS: Record<IconKey, () => JSX.Element> = {
  shield: Icon.shield,
  pulse: Icon.pulse,
  spark: Icon.spark,
  heart: Icon.heart,
};

const FEATURES: { icon: () => JSX.Element; title: string; sub: string }[] = [
  { icon: Icon.spark, title: "Daily check-in & RPE", sub: "Log training load, sleep, soreness in seconds" },
  { icon: Icon.gauge, title: "Readiness & risk flags", sub: "Green / amber / red, computed for you" },
  { icon: Icon.message, title: "Coach feedback", sub: "Notes and guidance, right where you train" },
  { icon: Icon.chart, title: "Trends & history", sub: "Watch every number move over time" },
];

export default function HomePage() {
  return (
    <main className="shell px-6 py-10">
      <div className="animate-rise">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-ink-muted">
            Apex
          </span>
        </div>
        <h1 className="mt-8 font-display text-[2.35rem] font-extrabold leading-[1.04] text-ink">
          Train by the numbers.
        </h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
          One performance OS. Choose how you’re signing in.
        </p>
      </div>

      <div className="mt-8 grid gap-3">
        {ROLE_THEME_LIST.map((theme, i) => (
          <RoleCard key={theme.role} theme={theme} delay={i * 60} />
        ))}
      </div>

      <section className="mt-10 animate-rise" style={{ animationDelay: "240ms" }}>
        <p className="label">What you get</p>
        <div className="surface-card mt-3 divide-y divide-line">
          {FEATURES.map((f) => {
            const FeatureIcon = f.icon;
            return (
              <div key={f.title} className="flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-accent-strong">
                  <FeatureIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{f.title}</span>
                  <span className="block text-[11px] leading-snug text-ink-muted">{f.sub}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-auto pt-10 text-center text-xs text-ink-muted">
        Existing accounts keep their saved role. New Google users are created from the role they pick.
      </p>
    </main>
  );
}

function RoleCard({ theme, delay }: { theme: RoleTheme; delay: number }) {
  const RoleIcon = ICONS[theme.icon];
  return (
    <Link
      href={`/login/${theme.role}`}
      style={{ ...accentVars(theme), animationDelay: `${delay}ms` }}
      className="surface-card animate-rise group flex items-center gap-3 p-4 transition hover:border-accent/40 hover:shadow-glow"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
        <RoleIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-semibold text-ink">{theme.label}</span>
        <span className="block text-[11px] leading-snug text-ink-muted">{theme.tagline}</span>
      </span>
      <span className="text-ink-faint transition group-hover:text-accent-strong">
        <Icon.chevron />
      </span>
    </Link>
  );
}

function Mark() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink text-surface">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    </span>
  );
}
