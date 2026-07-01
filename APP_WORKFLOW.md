# Apex — Complete Application Workflow

> A single-source explanation of **what this app is, how it's built, and how data
> flows end-to-end** across every role. Read this to understand the system before
> changing it. For visual/design rules see [`apps/web/DESIGN_SYSTEM.md`](apps/web/DESIGN_SYSTEM.md);
> for the guardrails that must never break see [`CLAUDE.md`](CLAUDE.md).

---

## 1. What the app is

**Apex** is a **sports‑performance platform** for an athletics academy. It lets an
academy track each athlete's daily training, wellness, recovery and performance,
turns those signals into a **readiness indicator** and **risk flags**, and shows
the right slice of that data to three kinds of users:

| Role | Device focus | What they do |
|---|---|---|
| **Athlete** | Mobile (phone) | Log a daily check‑in (wellness), RPE per session, attendance, recovery, notes; see their own readiness, plan, trends, and coach feedback. |
| **Coach** | Mobile | See a **squad overview** of only their assigned athletes, triage who needs attention (risk flags), drill into one athlete, set the training plan, record attendance/performance, and send feedback. |
| **Guardian** | Mobile | **Read‑only** follow of their linked athlete(s): today's summary, trends, and coach feedback. |

> There is **no Admin role** — it was removed by request. The platform is
> coach / athlete / guardian only. Safe wording is used throughout: "readiness
> indicator" / "risk flag" / "decision support" — never "diagnosis" or "prediction".

---

## 2. Tech stack & repo layout

Monorepo with two npm workspaces.

```
sports-coaching-platform/
├── apps/web/          → Next.js 14 (App Router) frontend — MOBILE ONLY
│   ├── app/           → routes (pages) per role
│   ├── components/    → AppShell, Card, Ring, charts/, ui, Timeline, Trend
│   └── lib/           → api client, roles, roleThemes
├── server/            → Express + Mongoose API, mounted under /api/*
│   └── src/
│       ├── routes/    → auth, coach, athlete, guardian
│       ├── middleware/→ auth (JWT), role gate, coachAthleteAccess (scope)
│       ├── models/    → Mongoose schemas (one per collection)
│       ├── services/  → dashboard, analytics, trends, activity (read models)
│       ├── lib/       → trainingCategories (RPE math), tokens
│       └── scripts/   → seed.ts
└── CLAUDE.md, APP_WORKFLOW.md (this file)
```

- **Frontend:** Next.js App Router, React, Tailwind, Recharts. Talks to the API at
  `http://localhost:4000` with `credentials: "include"` (cookie auth).
- **Backend:** Express + Mongoose (MongoDB). JWT access/refresh tokens in **httpOnly
  cookies**. All endpoints live under `/api/*`.
- **DB:** MongoDB (local `mongodb://127.0.0.1:27017/athletes` or Atlas). Tests use
  `mongodb-memory-server` (no external Mongo needed).

---

## 3. The request lifecycle (how every protected call is processed)

Every role router applies the **same three‑layer guard** before any handler runs.
This is the security spine of the app.

```
  Client (browser, cookie: accessToken)
        │  GET /api/coach/athletes/:id/daily-card
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. requireAuth            (middleware/auth.ts)                  │
│    • read JWT from Bearer header OR accessToken cookie          │
│    • verify signature; re-read the user FROM MONGO              │
│    • set req.actor = { userId, role }                           │
├───────────────────────────────────────────────────────────────┤
│ 2. requireRole("coach")   (middleware/role.ts)                  │
│    • wrong role → 403 forbidden_role                            │
├───────────────────────────────────────────────────────────────┤
│ 3. loadScope              (middleware/coachAthleteAccess.ts)    │
│    • coach    → req.actor.assignedAthleteIds  (active assigns)  │
│    • guardian → req.actor.linkedAthleteIds    (active links)    │
│    • athlete  → req.actor.athleteProfileId    (self)            │
├───────────────────────────────────────────────────────────────┤
│ 4. requireAthleteAccess("athleteId")  (per single-athlete route)│
│    • load target AthleteProfile                                 │
│    • assertCanAccessAthleteProfile → assertCanAccessAthlete     │
│        coach: id ∈ assignedAthleteIds   else 403 not_in_assignments
│        guardian: id ∈ linkedAthleteIds  else 403 not_linked_guardian
│        athlete: id == own profile       else 403 not_self        │
│    • 403 denials are written to AuditLog (outcome: "deny")      │
├───────────────────────────────────────────────────────────────┤
│ 5. handler — runs ONLY after scope is proven                   │
└───────────────────────────────────────────────────────────────┘
```

Router wiring (identical pattern for all three roles):

```ts
// coach.ts
router.use(requireAuth, requireRole("coach"), loadScope);
router.get("/athletes/:athleteId/...", requireAthleteAccess("athleteId"), handler);

// guardian.ts → requireRole("guardian")   (read-only routes)
// athlete.ts  → requireRole("athlete")    (self-scoped)
```

### The non‑negotiable invariant — coach scope
> A coach must **only ever** see data for athletes explicitly assigned to them.
> List endpoints filter by `req.actor.assignedAthleteIds`; single‑athlete endpoints
> use `requireAthleteAccess`. Never query an athlete‑scoped collection without one
> of those two. The three layers above must all stay intact.

---

## 4. Authentication & session flow

Auth is **cookie‑based** (httpOnly, so JS can't read the tokens). The frontend also
stores a non‑sensitive `scp.user` in `localStorage` purely for route‑guarding and
header display.

```
LOGIN   POST /api/auth/login { email, password }
        → bcrypt-verify password
        → issue accessToken (JWT, ~15 min)  + refreshToken (longer-lived)
        → Set-Cookie:
            accessToken   HttpOnly; SameSite=Lax; Path=/         (+Secure in prod)
            refreshToken  HttpOnly; SameSite=Lax; Path=/api/auth (+Secure in prod)
        → body: { accessToken, user:{ id,name,email,role,academyId } }
        → frontend: setStoredUser(user); router.push(dashboardPathForRole(role))

REQUEST any /api/* call sends the accessToken cookie automatically.
        On a 401 the api client calls /api/auth/refresh ONCE (single-flight),
        then retries the original request.

REFRESH POST /api/auth/refresh
        → read refreshToken cookie; verify + match stored hash; ROTATE it
        → set fresh accessToken + refreshToken cookies

LOGOUT  POST /api/auth/logout → clears both cookies + the stored refresh hash
WHOAMI  GET  /api/auth/me (requireAuth) → current user
```

- **Routing is driven only by the server‑returned role.** The `/login/<role>` page a
  user picks is cosmetic (it only themes the screen). `dashboardPathForRole(role)`
  maps the *server* role → `/coach|athlete|guardian/dashboard`.
- `requireAuth` **re‑reads the user from Mongo on every request**, so a deactivated
  or role‑changed user is caught immediately (the JWT is not trusted blindly).

---

## 5. Domain model (collections & relationships)

One Mongoose model per collection ([`server/src/models/`](server/src/models)).

```
              ┌──────────┐
              │ Academy  │
              └────┬─────┘
                   │ academyId (tag on most docs)
   ┌───────────────┼──────────────────────────────┐
   ▼               ▼                                ▼
┌──────┐   ┌────────────────┐              ┌─────────────────────┐
│ User │   │ AthleteProfile │◄────userId───│ User (role:athlete) │
│ role │   │ sport,position │              └─────────────────────┘
└──┬───┘   └───────┬────────┘
   │               │ athleteId (= AthleteProfile._id) is the key for ALL athlete data
   │               │
   │   ┌───────────┼───────────────────────────────────────────────┐
   │   ▼           ▼            ▼          ▼          ▼        ▼     ▼
   │ Attendance TrainingSession Wellness Recovery Performance Injury RpeMonitoring
   │ (per day)  (per day+slot)  (daily)  (daily)  (append)   (active) (per day+slot)
   │            AthleteNote   CoachComment
   │
   ├──< CoachAthleteAssignment  (coachId → athleteId, endedAt:null = active)
   └──< GuardianAthleteLink     (guardianId → athleteId, endedAt:null = active)

   AuditLog  ← every authorization deny (and admin-era writes) is logged here
```

Key facts:
- **`athleteId` everywhere = `AthleteProfile._id`** (not the User id). An athlete's
  `User` and `AthleteProfile` are linked by `AthleteProfile.userId`.
- **Relationships are time‑bounded:** `CoachAthleteAssignment` / `GuardianAthleteLink`
  have `endedAt`. `endedAt: null` means *active*; ending a relationship instantly
  revokes access (covered by tests).
- **Per‑day uniqueness:** Attendance, Wellness, Recovery are one row per athlete per
  day (upserted). TrainingSession & RpeMonitoring are per athlete per day per **slot**
  (`AM`/`PM`). Performance is **append‑only** history. Injury has an `active` state.

---

## 6. The analytical core (what makes it "smart")

Two readiness calculations and one risk‑flag rule turn raw 0–5 self‑ratings into the
green/amber/red signals shown across the app. All status colors are **semantic**
(green = ready, amber = caution, red = risk).

### a) Wellness readiness — `computeReadiness` ([dashboard.ts](server/src/services/dashboard.ts))
From the daily **Wellness** check‑in (each field 1–5):
```
positive (higher better): sleepQuality, mood        → (v-1)/4 * 100
negative (lower better):  stress, soreness, fatigue → (5-v)/4 * 100
readinessScore = round(average of available components)   // 0–100
```

### b) RPE readiness & training load — [trainingCategories.ts](server/src/lib/trainingCategories.ts)
From a per‑session **RpeMonitoring** entry (fields 0–5, rpe 0–10):
```
calculatedTrainingLoad = plannedIntensityPercent × rpe

readinessScore = round(
    sleepQuality/5*25 + moodMotivation/5*25
  + (5-fatigue)/5*25 + (5-muscleSoreness)/5*25 )          // 0–100
band: green ≥ 80 · amber 60–79 · red < 60
```

### c) Risk flag — `deriveLoadAndRisk`
```
RED   if (rpe ≥ 8 AND fatigue ≥ 4) OR (muscleSoreness ≥ 4 AND fatigue ≥ 4)
AMBER if sleepQuality ≤ 2 OR moodMotivation ≤ 2 OR restingHeartRate ≥ 100
GREEN otherwise
riskReasons = human-readable list of which rule(s) fired
```

> When an athlete submits an RPE entry, the server computes load + risk + readiness
> **server‑side** and stores them on the row, so the coach's squad view can flag the
> athlete without recomputing. There are **27 training categories** (ENDURANCE, MAX
> SPEED, plyos, strength, recovery, etc.).

### Read models (services)
- **`buildDailyCardsForAthletes` / `buildDailyCardForAthlete`** — assembles one
  "daily card" per athlete for a date by joining Attendance + TrainingSession (AM/PM)
  + Wellness (→ readiness) + Recovery + latest Performance + Injury + RpeMonitoring.
  This is what the coach squad view and the athlete/guardian "today" view render.
- **`analytics.ts`** — per‑day time series for charts: `buildWellnessSeries`,
  `buildAttendanceSeries`, `buildSessionSeries`, `buildPerformanceSeries`, and
  `buildSquadSeries` (coach rollup: avg readiness, attendance rate, avg load, red‑flag
  count across the coach's assigned athletes).
- **`trends.ts`** — `buildTrendSeries` (trailing per‑day readiness/load sparkline).
- **`activity.ts`** — `buildActivityFeed` (merged recent‑activity timeline).

---

## 7. Complete API reference

All routes are under `/api`. Every router below is gated `requireAuth +
requireRole(<role>) + loadScope`; single‑athlete routes additionally run
`requireAthleteAccess`.

### Auth — `/api/auth` (public except `/me`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/login` | email+password → tokens (cookies) + user |
| POST | `/refresh` | rotate tokens from the refresh cookie |
| GET  | `/me` | current user (requireAuth) |
| POST | `/logout` | clear cookies + refresh hash |

### Athlete — `/api/athlete` (self‑scoped)
| Method | Path | Purpose |
|---|---|---|
| GET  | `/me` | own profile |
| GET  | `/daily?date` | own daily card |
| GET  | `/trends?days` | own readiness/load sparkline |
| GET  | `/activity?limit` | own activity feed |
| GET  | `/analytics/{wellness,attendance,sessions,performance}` | own chart series |
| POST | `/wellness` | submit daily wellness check‑in |
| POST | `/attendance` | self‑mark attendance |
| POST | `/training/:slot` | log own session outcome (AM/PM) |
| POST | `/recovery` | log recovery (sleep, HRV, resting HR…) |
| POST | `/notes` · GET `/notes?date` | personal notes |
| GET  | `/coach-comments?date` | coach feedback addressed to them |
| POST | `/rpe-monitoring` · GET `/rpe-monitoring?date` | submit/read RPE (server computes load+risk+readiness) |

### Coach — `/api/coach` (scoped to assigned athletes)
| Method | Path | Purpose |
|---|---|---|
| GET  | `/athletes` | assigned roster |
| POST | `/athletes` | **onboard** a new athlete `{name, email, sport, position?, timezone?}` → account + profile + assignment; returns one-time `tempPassword` |
| POST | `/athletes/:id/guardians` | add a guardian for an assigned athlete `{name, email, relationship?}` → account + link (reuses an existing guardian); returns `tempPassword?` |
| GET/POST | `/coaches` | **academy owner only** (`isAcademyOwner` coach): list / create coaches in the owner's academy; create returns `tempPassword`. Non-owners → `403 forbidden_not_owner` |
| GET  | `/dashboard?date` | daily cards for **all** assigned athletes |
| GET  | `/analytics/squad?days` | squad rollup (avg readiness, attendance, load, red flags) |
| GET  | `/athletes/:id/daily-card?date` | one athlete's daily card |
| GET  | `/athletes/:id/rpe-monitoring?date` | that athlete's AM/PM RPE |
| GET  | `/athletes/:id/trends?days` | readiness/load sparkline |
| GET  | `/athletes/:id/activity?limit` | activity feed |
| GET  | `/athletes/:id/analytics/{wellness,attendance,sessions,performance}` | chart series |
| GET  | `/athletes/:id/performance?metric=&limit=` | performance history |
| POST | `/athletes/:id/comment` | write feedback `{date?, body}` |
| POST | `/athletes/:id/attendance` | record attendance `{date?, status, note?}` |
| POST | `/athletes/:id/training/:slot` | set the plan `{type, plan, status, durationMin, intensityRpe, notes}` |
| POST | `/athletes/:id/performance` | append a result `{metric, value, unit, context?}` |

### Guardian — `/api/guardian` (read‑only, linked athletes)
| Method | Path | Purpose |
|---|---|---|
| GET | `/athletes` | linked athletes (summary) |
| GET | `/athletes/:id/daily-card?date` | read‑only daily summary |
| GET | `/athletes/:id/trends?days` | read‑only trends |
| GET | `/athletes/:id/activity?limit` | read‑only activity |
| GET | `/athletes/:id/analytics/{wellness,attendance,sessions,performance}` | read‑only charts |
| GET | `/athletes/:id/coach-comments?date` | coach feedback |

> Note: coaches **own the plan** (type/intensity/duration are coach‑set via
> `training/:slot`); the athlete logs the *outcome*/their own session status. Coaches
> use coach endpoints only — there are no admin endpoints.

---

## 8. Frontend — structure & per‑role flows

**Mobile‑only.** Every authenticated screen renders inside one shared frame,
[`AppShell`](apps/web/components/AppShell.tsx): a sticky page header (role label,
title, subtitle, user) + a bottom **tab bar**, tinted per role (athlete = orange,
coach = lime, guardian = teal). The column is `max-w-md` — it fills phones
edge‑to‑edge and centers as an intentional app surface on tablets. Charts are
[Recharts](apps/web/components/charts) re‑themed to the design tokens and driven by
the real analytics endpoints.

### Routes
```
/                       role chooser (Athlete / Coach / Guardian)
/login/<role>           themed login (role is cosmetic; server decides destination)
/athlete/dashboard      athlete home (tabs: Today · Trends · Log · Coach)
/athlete/rpe-monitoring per-session RPE logging form
/coach/dashboard        squad overview (tab: Squad overview · Roster)
/coach/athletes         roster list
/coach/athletes/[id]    athlete detail (sub-tabs: Overview/Training/RPE/Performance/Activity)
/guardian/dashboard     linked-athlete view (tabs: Today · Trends · Feedback)
```

### Information architecture (every screen answers: *what happened / now / needs attention / what next*)
- **Athlete (Today):** readiness hero ring + guidance → quick stats (sleep/recovery/
  load) → today's plan (AM/PM) → training load → fast check‑in / RPE. **Trends:**
  readiness+load combo, wellness signals, performance. **Log:** check‑in, attendance,
  training, recovery, notes. **Coach:** feedback + activity.
- **Coach (Squad overview):** KPI strip (athletes / present / sessions / avg readiness)
  → **needs‑attention triage** (one pill per flagged athlete) → squad analytics chart
  → full roster of athlete cards (ring + AM/PM/soreness tiles + RPE risk + inline
  feedback composer). **Roster** is a searchable list; tapping an athlete opens the
  detail with sub‑tabs.
- **Guardian (Today):** read‑only readiness + sessions + sleep/recovery → **Trends**
  → **Feedback**, with a linked‑athlete switcher. No logging.

### Frontend auth/data plumbing ([lib/api.ts](apps/web/lib/api.ts))
- `apiFetch` sends `credentials:"include"`; on 401 it does a **single‑flight**
  `/api/auth/refresh` then retries.
- Route guards read `scp.user` from `localStorage`; a missing/failed session →
  `router.replace("/")`.
- Required UI states are preserved everywhere: **loading / error / success /
  validation / empty / 401‑403**.

---

## 9. End‑to‑end example: "athlete logs a hard session, coach sees the red flag"

```
1. Athlete opens /athlete/rpe-monitoring, submits PM RPE:
   POST /api/athlete/rpe-monitoring { sessionType:"PM", trainingCategory,
        plannedIntensityPercent, rpe:9, fatigue:5, muscleSoreness:4, ... }

2. Server (athlete route, self-scoped):
   • deriveLoadAndRisk() → load = intensity×9, riskFlag="red"
     (rpe≥8 & fatigue≥4), readinessScore + band computed
   • stores the RpeMonitoring row WITH the derived fields

3. Coach opens /coach/dashboard:
   GET /api/coach/dashboard?date=today
   • loadScope set assignedAthleteIds (this coach only)
   • buildDailyCardsForAthletes() joins each athlete's data incl. today's RPE
   • the athlete's card shows a RED chip + "RPE 9 with high fatigue 5"
   • the athlete appears in the "Needs attention" triage strip

4. Coach taps the athlete → /coach/athletes/:id, reviews trends,
   then POST /api/coach/athletes/:id/comment { body:"Back off tomorrow…" }

5. Athlete (Coach tab) and Guardian (Feedback tab) both read that comment:
   GET /api/athlete/coach-comments  /  GET /api/guardian/.../coach-comments
```

Every hop is scope‑checked: the coach only reaches this athlete because the athlete
is in their active `CoachAthleteAssignment`; the guardian only via an active
`GuardianAthleteLink`.

---

## 10. Running, testing, seeding

All commands run from the repo root (npm workspaces).

| Command | Purpose |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | run web (:3000) + server (:4000) in parallel |
| `npm run dev:web` / `npm run dev:server` | run one side |
| `npm test --workspace server` | Jest + `mongodb-memory-server` (RBAC + dashboard + analytics) |
| `npm test --workspace apps/web` | frontend unit tests (roles, themes, login) |
| `npm run typecheck --workspace apps/web` | `tsc --noEmit` |
| `npm run seed --workspace server` | seed deterministic demo data |

**Seed accounts** (`server/src/scripts/seed.ts`): 1 academy, 2 coaches, 1 guardian,
4 athletes, ~120 days of data.

```
coach.kumar@acme.test   / Coach@123
coach.singh@acme.test   / Coach@123
parent.rao@acme.test    / Guardian@123
athlete.arjun@acme.test / Athlete@123   (also bala / chetan / diya)
```

**Env:** `server/.env` provides `MONGODB_URI`, `PORT`, `CORS_ORIGIN`, the four JWT
secrets/TTLs (`JWT_ACCESS_SECRET/REFRESH_SECRET/ACCESS_TTL/REFRESH_TTL`). The web app
reads `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:4000`).

> **Dev note:** Next 14's `.next` cache corrupts on build churn — do **not** run
> `next build` against the live dev tree. Verify with the running dev server +
> `tsc --noEmit`. If it corrupts: stop the dev server, delete `apps/web/.next`,
> restart one dev server.

---

## 11. Invariants & guardrails (do not break)

1. **Coach scope** — coaches only ever touch `assignedAthleteIds`; the three‑layer
   guard (auth → role → scope/`requireAthleteAccess`) stays intact on every route.
2. **Server‑decided routing** — destinations come from the server‑returned role, never
   from the login page the user picked.
3. **Tokens are httpOnly** — JS never reads access/refresh tokens; only `scp.user`
   (non‑sensitive) is in `localStorage`.
4. **Mobile‑only frontend** — one `AppShell`, no desktop layout, no admin surface.
5. **Semantic status colors** — green/amber/red mean ready/caution/risk only.
6. **Safe wording** — "readiness indicator" / "risk flag", never "diagnosis"/"prediction".
7. **Accessibility** — WCAG‑AA contrast, visible focus, semantic landmarks,
   reduced‑motion support.
8. **Auth denials are audited** — 403s on athlete access write an `AuditLog` row.
