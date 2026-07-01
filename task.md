Use the sports-coaching-platform-builder skill for this task.

GOAL
Do a COMPLETE UI/UX redesign of the whole app — visual design system, layout, information architecture, and the placement/ordering of every section on every role dashboard (Coach, Athlete, Guardian). I want it to look and feel like a best-in-class sports-performance product, not a generic admin app. Base the design on real research, not guesses.

PHASE 0 — RESEARCH (do this first, with web search)
Use WebSearch/WebFetch to study the UX patterns of the leading athlete/performance apps and write me a short synthesis (bullet points + sources) covering:
- WHOOP, Oura, Garmin Connect, Strava, TrainingPeaks, Hudl/TeamBuildr (coach side).
- For each: how they structure the home/today view, how they present readiness/recovery/load, navigation model (tab bar vs sidebar), data-density choices, card vs chart usage, color/status systems, typography, and mobile vs desktop layout.
- Then distill 6–10 concrete design principles that fit MY app (multi-role, athlete mobile-first, coach desktop-first, status-driven, analytics-heavy).
Cite the sources you used.

PHASE 1 — DESIGN DIRECTION (get my approval before building)
Propose 2–3 distinct visual directions (e.g. "WHOOP-style dark minimal", "Strava-vibrant light", "Garmin data-dense"). For each, give: mood, color palette (with hex), typography pairing, navigation model, and an ASCII/wireframe sketch of the Athlete "today" view and the Coach dashboard. Recommend one. STOP and let me pick before implementing.

PHASE 2 — DESIGN SYSTEM
For the chosen direction, define and implement a cohesive system in the existing Tailwind setup (apps/web/app/globals.css + tailwind.config.ts): color tokens (keep the green/amber/red status semantics), typography scale, spacing, radii, elevation, and a documented component kit (cards, chips, rings, tabs, nav, buttons, form controls). Reuse/restyle existing components (Ring, Timeline, StatTile, the Recharts chart components) rather than reinventing — re-theme the charts to match.

PHASE 3 — INFORMATION ARCHITECTURE (place every section)
Define and implement the section layout and ordering for each role, answering "what happened / what's happening now / what needs attention / what to do next":
- Athlete (mobile-first): readiness hero, today's plan, fast check-in, RPE, load/wellness/recovery/performance charts, coach feedback, activity. Decide a navigation model (tab bar?) instead of one long scroll if better.
- Coach (desktop-first): squad overview + needs-attention triage + squad analytics + roster; athlete detail with tabs.
- Guardian (read-only): linked-athlete summary + trends + feedback.
Add proper navigation (responsive nav/sidebar/tab bar) and consistent page headers across roles.

HARD CONSTRAINTS — DO NOT BREAK
- Do NOT change the backend, the coach-scope RBAC invariant, the auth model, or the analytics/API contracts. This is a frontend redesign only.
- Keep all charts driven by the real analytics endpoints already built; re-theme them, don't replace the data wiring.
- Keep accessibility: WCAG AA contrast, keyboard focus, semantic landmarks, reduced-motion support.
- Preserve required form states (loading/error/success/validation/empty/401-403) and the safe wording ("readiness/risk indicator", never "diagnosis/prediction").
- Mobile-first for athlete/guardian, responsive desktop for coach.

DEV ENVIRONMENT NOTE
This app is Next.js 14.2.5 and its .next dev cache corrupts easily ("Cannot find module './xxx.js'") when builds/edits churn. Do NOT run `next build` against the live dev tree. Verify with the running dev server + `tsc --noEmit`. If the cache corrupts: stop the dev server, rm -rf apps/web/.next, restart one dev server.

WORKFLOW
Follow the skill's workflow: output current state → research synthesis → proposed directions (await my pick) → design system → IA implementation per role → verification. Implement role-by-role so I can review between roles.

VERIFICATION (after each role)
Run tsc --noEmit, then use the Playwright MCP to log in as that role and screenshot the redesigned screens at mobile (390px) and desktop (1440px). Confirm charts render real data and nothing regressed. Report what changed with before/after notes.

Start with PHASE 0 research now.
