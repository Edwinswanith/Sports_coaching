# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root (npm workspaces).

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Run mobile + server in parallel (`predev` runs `scripts/dev-clean.mjs`) |
| `npm run dev:server` | Express dev via ts-node-dev (http://localhost:4000) |
| `npm run dev:mobile` | Expo dev server for the native/PWA app (`mobile`) |
| `npm run build` | Build server TypeScript |
| `npm run typecheck` | `tsc --noEmit` across server + mobile (or `typecheck:server` / `:mobile`) |
| `npm test` / `npm test --workspace server` | Run server Jest suite (uses `mongodb-memory-server`, `--runInBand`) |
| `npx jest tests/coach-dashboard.test.ts --workspace server` | Run a single server test file |
| `npm run seed --workspace server` | Run `server/src/scripts/seed.ts` |
| `npm run create-owner --workspace server` | Bootstrap the first academy-owner coach (no in-app path exists) |
| `npm run lint --workspace mobile` | ESLint for mobile |

Env setup: copy `.env.example` to `.env`, `server/.env`, and `mobile/.env`. Server reads env via [server/src/config/env.ts](server/src/config/env.ts) (`MONGODB_URI`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `GOOGLE_CLIENT_ID` — comma-separated client IDs; empty disables Google sign-in). When `MONGODB_URI` is non-local, the server **refuses to start** unless the JWT secrets are non-placeholder (`strictSecrets`). Mobile reads `EXPO_PUBLIC_API_BASE_URL` (defaults to the deployed Cloud Run API).

## Architecture

Monorepo (npm workspaces: `mobile` + `server`) with two workspaces:
- [mobile/](mobile/) — Expo (expo-router, React Native) native app, also runnable as web/PWA. Mirrors the web app's screens by role (`src/app/{athlete,coach,guardian,login}`); shared client code in [mobile/src/lib/](mobile/src/lib/).
- [server/](server/) — Express + Mongoose API mounted under `/api/*`. Entry: [server/src/index.ts](server/src/index.ts).

**Mobile auth transport.** The mobile client stores tokens in **expo-secure-store** and sends the access token as a **`Bearer` header** ([mobile/src/lib/api.ts](mobile/src/lib/api.ts)). The server's [auth middleware](server/src/middleware/auth.ts) accepts bearer headers and legacy cookies. Clients share the same `/api/*` contract and the `scp.user` profile cache for role routing.

### Non-negotiable invariant: coach scope

A coach must only ever see data for athletes explicitly assigned to that coach (across attendance, training, wellness, recovery, performance). Enforcement is **three-layered** and all three must remain intact:

1. **JWT auth** — [server/src/middleware/auth.ts](server/src/middleware/auth.ts) verifies the access token (bearer header or `accessToken` cookie), re-reads the user from Mongo, and sets `req.actor = { userId, role }`.
2. **Scope loader + authz guard** — [server/src/middleware/coachAthleteAccess.ts](server/src/middleware/coachAthleteAccess.ts) `loadScope` populates `req.actor.assignedAthleteIds` (coach), `linkedAthleteIds` (guardian), `athleteProfileId` (athlete), and `academyId`. `requireAthleteAccess(param)` loads the target `AthleteProfile` and calls `assertCanAccessAthleteProfile`, which delegates to the role-scope check `assertCanAccessAthlete`.
3. **Route role gate** — [server/src/middleware/role.ts](server/src/middleware/role.ts) `requireRole(...)` runs before scope-sensitive routers.

Pattern used by every coach-scoped router (see [server/src/routes/coach.ts](server/src/routes/coach.ts)):

```ts
router.use(requireAuth, requireRole("coach"), loadScope);
router.get("/athletes/:athleteId/...", requireAthleteAccess("athleteId"), handler);
```

When adding new coach endpoints: never query athlete-scoped collections without first restricting to `req.actor.assignedAthleteIds` (or using `requireAthleteAccess` for single-athlete routes). The coach router is gated `requireRole("coach")`, so any non-coach actor gets `403 forbidden_role`.

> **No admin.** The admin role, the `/api/admin/*` endpoints, and the admin frontend flow were removed by request. The platform is **coach / athlete / guardian only**. Do not reintroduce an `admin` role without an explicit ask. `User.academyId` still exists and tags audit rows, but no longer gates access.
>
> **Academy owner (not admin).** `User.isAcademyOwner` is a *scoped coach capability*, added by explicit request: an owner is a normal `coach` who may additionally create/list other coaches in their own academy via the owner-gated `GET/POST /api/coach/coaches` (see `requireOwner` in [server/src/routes/coach.ts](server/src/routes/coach.ts)). It is **not** a role, has **no** academy-wide data access, and adds **no** `/admin` surface — it only fills the coach-provisioning gap left by removing admin. Don't expand it into a general admin without an explicit ask. Bootstrap the first owner with `npm run create-owner --workspace server` ([server/src/scripts/create-owner.ts](server/src/scripts/create-owner.ts)) — there is no in-app path to create the first coach.
>
> **Athlete self-signup (the one exception).** By explicit request, athletes — and *only* athletes — may self-register via the public `POST /api/auth/register-athlete` ([server/src/routes/auth.ts](server/src/routes/auth.ts)), UI at `/register/athlete`. It creates a `User(role: athlete)` + `AthleteProfile` with **no coach assignment and no academy**, then signs them in. Such an athlete is simply *unassigned*, so they stay invisible to every coach (coach-scope invariant intact) until a coach adds them.
>
> **Google sign-in self-signup.** `POST /api/auth/google` ([server/src/routes/auth.ts](server/src/routes/auth.ts)) verifies the Google ID token server-side (Google `tokeninfo` endpoint → asserts issuer/audience/`email_verified`; audience must be in `env.googleClientIds`). For a **first-time** Google identity it provisions an account per the `requestedRole` from the login screen — `athlete` (default; also creates an `AthleteProfile`) or `coach`. Guardian self-signup is rejected (`self_signup_role_not_supported`). Existing users never change role and disabled accounts are never reactivated. A self-provisioned athlete is still unassigned, so the coach-scope invariant holds. (This expands the password path: password self-signup remains **athlete-only**; do not add password self-signup for other roles.)
>
> A coach pulls a self-registered athlete onto their squad via `POST /api/coach/athletes/link` (body `{ email }`) — the counterpart to the account-creating `POST /api/coach/athletes`. It only creates a `CoachAthleteAssignment` (no new account, no password), adopts an academy-less athlete into the coach's academy, and 404s on an unknown/non-athlete email. UI: the "Create new / Link existing" toggle on `/coach/athletes/new`.

### Domain model

Roles: `coach | athlete | guardian` ([server/src/models/User.ts](server/src/models/User.ts)). Athletes have a separate `AthleteProfile` keyed by `userId`; coach→athlete relationships live in `CoachAthleteAssignment` (with `endedAt: null` meaning active), guardian→athlete in `GuardianAthleteLink`. Daily-card aggregation across `Attendance`, `TrainingSession`, `Wellness`, `Recovery`, `Performance`, `Injury` lives in [server/src/services/dashboard.ts](server/src/services/dashboard.ts) (`buildDailyCardsForAthletes`, `computeReadiness`, `dayRange`). Other athlete-scoped collections: `RpeMonitoring`, `WaterIntake`, `CoachComment`, `AthleteNote`, `Announcement`, `Notification`, `Message`. Service layer beyond dashboard: [activity.ts](server/src/services/activity.ts), [analytics.ts](server/src/services/analytics.ts), [trends.ts](server/src/services/trends.ts), [notifications.ts](server/src/services/notifications.ts), [messaging.ts](server/src/services/messaging.ts).

> **Direct messaging.** Coach⇄athlete 1:1 threads ([server/src/models/Message.ts](server/src/models/Message.ts)). A thread *is* the pair `(coachId, athleteId)` — no Conversation model. `senderRole` marks the author; a message is unread by its recipient while `readAt` is null. Coach routes live under `/api/coach/athletes/:athleteId/messages` + `/api/coach/messages/{threads,unread-count}` (gated by `requireAthleteAccess`, so assigned-only); athlete routes under `/api/athlete/messages/:coachId` + `/api/athlete/messages/{threads,unread-count}` (each validates the coach is an **active** assignment → `403 coach_not_assigned`). Sending fires a best-effort `type: "message"` notification. Delivery is **client-poll** (no WebSocket/SSE yet) — reads aren't rate-limited, sends are. Logic centralized in [messaging.ts](server/src/services/messaging.ts). Mobile screens live under [mobile/src/app/coach/messages.tsx](mobile/src/app/coach/messages.tsx) and [mobile/src/components/MessageCenter.tsx](mobile/src/components/MessageCenter.tsx). Routers: `auth`, `coach`, `athlete`, `guardian`, `notifications` (each athlete/guardian router applies the same scope-loader + access-guard pattern, scoping to `athleteProfileId` / `linkedAthleteIds`).

### Tests

Jest + ts-jest + `mongodb-memory-server` (no external Mongo needed). Tests live in [server/tests/](server/tests/) and cover access control, the coach dashboard, athlete/guardian workspaces, RPE/readiness, analytics, trends, and onboarding end-to-end. Mobile has focused Jest tests for Ask Agent report intent parsing.

## Deployment

Deploy the API server to **Google Cloud Run** via [deploy.bat](deploy.bat). Mobile builds are produced from [mobile/](mobile/) with Expo/EAS. Server secrets come from `env.server.yaml` (copy `env.server.yaml.example`). For local API dependencies, [docker-compose.yml](docker-compose.yml) brings up Mongo + API. Cloud Run egress must be allow-listed in MongoDB Atlas.

## Project blueprint

The full design (architecture, schema, RBAC matrix, API contract, UI flows, step-by-step plan) lives in [skills/sports-coaching-platform-builder/](skills/sports-coaching-platform-builder/). Consult it before adding new collections, endpoints, or pages — the existing code follows it and new code should too.
