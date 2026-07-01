# Apex — Design System ("Evergreen Performance")

The frontend follows one cohesive system. New screens should reuse these tokens
and components rather than introducing ad-hoc styles.

## Direction

Light, premium, athletic — a warm off-white canvas with **deep emerald** as the
signature accent, **refined amber** for expressive energy, and **teal** for the
guardian surface. Sophisticated and trustworthy rather than neon/sporty. Status
color is **sacred and semantic only** (green = ready, amber = caution, red =
risk). Brand/role accents and the expressive "energy" amber are a **separate
channel** and never encode status. All accent fills are AA-contrast-safe (emerald
& teal carry white text; amber carries near-black ink).

## Tokens

All colors are CSS custom properties (RGB channel triplets) in
[`app/globals.css`](app/globals.css), surfaced to Tailwind in
[`tailwind.config.ts`](tailwind.config.ts) so every utility takes an `/opacity` modifier.

| Token | Tailwind | Use |
|---|---|---|
| `--surface` / `--surface-raised` / `--surface-inset` | `bg-surface` / `bg-surface-raised` / `bg-surface-inset` | page / cards / fields & tiles |
| `--ink` / `--ink-muted` / `--ink-faint` | `text-ink…` | primary / secondary / helper text (WCAG-tuned) |
| `--accent` / `--accent-strong` / `--accent-ink` / `--accent-soft` | `accent…` | role accent: fills, active states, accent text, text-on-fill, tint |
| `--energy` / `--energy-strong` / `--energy-soft` | `energy…` | **expressive only** (training-load bars, hero wash) — never status |
| `--ok` / `--warn` / `--bad` | `ok` / `warn` / `bad` | **status only**: green / amber / red |
| `--line` / `--line-strong` | `border-line` / `border-line-strong` | hairlines |

**Per-role accent.** [`lib/roleThemes.ts`](lib/roleThemes.ts) overrides `--accent*`
per role (coach = emerald `#0B7D55`, athlete = amber `#E0892B`, guardian = teal
`#0B6E7C`). `AppShell` applies it via `accentVars`, so the same components retint
automatically per role. Chart series colors mirror these in
[`charts/theme.ts`](components/charts/theme.ts) — readiness = emerald, load =
amber, recovery/attendance = blue (kept distinct so overlaid lines never collide).

> **Mobile-only.** This is a phone app (Android/iOS) — there is no desktop layout
> and **no Admin role/section**. Every screen is the single `AppShell` (sticky
> header + bottom tab bar): a `max-w-md` column that fills phones edge-to-edge and
> centers as an intentional app surface on the branded canvas on tablets. Content
> grids stay single/2-col (no viewport `sm:`/`xl:` expansion) so nothing cramps.

- **Type:** native-first system stack — SF Pro on Apple (`-apple-system`, no
  download), Roboto on Android, self-hosted Inter (`--font-body`, via next/font)
  as the web fallback. `font-display` and `font-sans` share this one stack
  (defined as `NATIVE_STACK` in [`tailwind.config.ts`](tailwind.config.ts)); weight +
  size carry the hierarchy. Numbers use the same family at bold weight with
  tabular numerals (`.nums`). Inter wired in [`app/layout.tsx`](app/layout.tsx).
- **Radii:** `rounded-xl` (controls), `rounded-2xl` (cards), `rounded-3xl` (hero).
- **Elevation:** `shadow-raised` (cards) → `shadow-pop` (hover lift) → `shadow-hero` (hero).
- **Motion:** `animate-rise`, `animate-ring-fill`; all suppressed under
  `prefers-reduced-motion`.

## Component kit

| Component | File | Notes |
|---|---|---|
| `AppShell` | [`components/AppShell.tsx`](components/AppShell.tsx) | The single mobile frame for **all** roles: a `max-w-md` column (fills phones, centers on tablets), sticky page header (role label, title, subtitle, user), bottom tab bar, per-role accent, sign-out. Safe-area insets top & bottom. |
| `Segmented` | `components/AppShell.tsx` | Reusable date/metric/section toggle. |
| `Card` | [`components/Card.tsx`](components/Card.tsx) | `surface-card` with optional title/action. |
| `Ring` | [`components/Ring.tsx`](components/Ring.tsx) | Signature readiness ring; `bandFor()` maps a 0–100 score → green/amber/red. |
| `Chip` / `StatTile` / `Icon` / `dash` | [`components/ui.tsx`](components/ui.tsx) | Status pill, metric tile, inline SVG icon set, `—` fallback. |
| `Timeline` | [`components/Timeline.tsx`](components/Timeline.tsx) | Merged activity feed. |
| `Trend` (`TrendRow`) | [`components/Trend.tsx`](components/Trend.tsx) | Sparkline + good/bad/neutral direction caret. |
| `NotificationCenter` | [`components/NotificationCenter.tsx`](components/NotificationCenter.tsx) | Header bell + badge + bottom-sheet center (all roles, via `AppShell`). Badge uses role accent for normal unread, status red only when a High-priority item is unread. Overlay **portals into `#app-shell`** to escape the header's `backdrop-filter` containing block while keeping the role accent. Data: [`lib/notifications.ts`](lib/notifications.ts) → `/api/notifications`. |
| Charts | [`components/charts/`](components/charts) | Recharts panels driven by the real analytics endpoints. Colors mirror tokens in [`charts/theme.ts`](components/charts/theme.ts) — load = energy-orange. Re-theme there, never rewire data. |
| Trend insight | [`charts/trendStats.ts`](components/charts/trendStats.ts), [`charts/TrendBadge.tsx`](components/charts/TrendBadge.tsx) | `summarizeTrend` smooths recent-vs-baseline into a verdict; `TrendBadge` shows ▲ Improving / ▼ Declining / → Steady (direction-aware via `lowerIsBetter`; `neutral` for load). `TrendTile` = line-colored headline value + badge above each chart. |
| `ChartTabs` | [`charts/ChartTabs.tsx`](components/charts/ChartTabs.tsx) | Tabbed + swipeable chart switcher for the Trends sections — name tabs on top, one chart at a time, horizontal swipe + position dots. All slides stay mounted (translated flex row) so switching is instant and Recharts keeps real width. Used by athlete/coach-detail/guardian Trends. |

Utility classes: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.field`, `.chip`
(+ `.chip-ok/warn/bad`), `.label`, `.surface-card`, `.card-hover`, `.hero-card`,
`.nav-item(--active)`, `.tab-item(--active)`, `.seg`/`.seg-btn(--active)`.

**Button hierarchy.** One solid `.btn-primary` (filled accent) per view — the
single weightiest action. Prominent secondary actions use `.btn-secondary` (light
accent-tinted, same size) so the page stays visually light. `.btn-ghost` is for
low-key/tertiary actions and icon buttons (back, sign-out, copy).

## Information architecture (per role)

Every dashboard answers: **what happened / now / needs attention / what next.**

- **Athlete** (tab bar): **Today** (readiness hero + guidance, quick
  stats, plan, load) · **Trends** (charts) · **Log** (check-in, attendance, training,
  recovery, notes) · **Coach** (feedback, activity).
- **Coach** (tab bar): **Squad overview** (KPIs → needs-attention triage →
  squad analytics → roster) · **Roster**; athlete detail keeps
  Overview/Training/RPE/Performance/Activity sub-tabs.
- **Guardian** (tab bar, read-only): **Today** · **Trends** · **Feedback**, with a
  linked-athlete switcher.

## Guardrails

- **Backend / RBAC / API contracts unchanged** — this is a frontend redesign only.
  Charts stay wired to the existing analytics endpoints.
- **Accessibility:** WCAG-AA contrast, visible `:focus-visible` rings, semantic
  landmarks (`header`/`nav`/`main`/`aside`), `aria-current` on active nav, reduced-motion.
- **Safe wording:** "readiness indicator" / "risk flag" / "coach decision support" —
  never "diagnosis" or "prediction".
- **Dev note:** Next 14.2.5 `.next` cache corrupts on build churn. Verify with the
  running dev server + `npm run typecheck --workspace apps/web`. Do **not** run
  `next build` against the live dev tree.
