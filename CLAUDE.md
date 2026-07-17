# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root (npm workspaces).

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Run web + server in parallel (`predev` runs `scripts/dev-clean.mjs`) |
| `npm run dev:web` | Next.js dev server (http://localhost:3000) |
| `npm run dev:server` | Express dev via ts-node-dev (http://localhost:4000) |
| `npm run dev:mobile` | Expo dev server for the native/PWA app (`apps/mobile`) |
| `npm run build` | Build web then server |
| `npm run typecheck` | `tsc --noEmit` across web + server + mobile (or `typecheck:web` / `:server` / `:mobile`) |
| `npm test` / `npm test --workspace server` | Run server Jest suite (uses `mongodb-memory-server`, `--runInBand`) |
| `npx jest tests/coach-dashboard.test.ts --workspace server` | Run a single server test file |
| `npm run seed --workspace server` | Run `server/src/scripts/seed.ts` |
| `npm run create-owner --workspace server` | Bootstrap the first academy-owner coach (no in-app path exists) |
| `npm run lint --workspace apps/web` / `--workspace apps/mobile` | ESLint for web / mobile |

Env setup: copy `.env.example` to `.env`, `server/.env`, and `apps/web/.env.local`. Server reads env via [server/src/config/env.ts](server/src/config/env.ts) (`MONGODB_URI`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `GOOGLE_CLIENT_ID` — comma-separated client IDs; empty disables Google sign-in). When `MONGODB_URI` is non-local, the server **refuses to start** unless the JWT secrets are non-placeholder (`strictSecrets`). The web bundle bakes `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at **build** time; mobile reads `EXPO_PUBLIC_API_BASE_URL` (defaults to the deployed Cloud Run API). Optional server-side `GEMINI_API_KEY`/`GEMINI_MODEL` power workout-image conversion and voice-intent NLU (mock fallback when unset — see below). Optional `GOOGLE_API_KEY`/`DEEP_GRAM` in `apps/web/.env.local` are unrelated and power only the isolated `/voice-demo` sandbox, not the production API.

## Architecture

Monorepo (npm workspaces: `apps/*` + `server`) with three workspaces:
- [apps/web/](apps/web/) — Next.js App Router frontend. **Mobile-only** (phone/PWA target, no desktop layout); design system in [apps/web/DESIGN_SYSTEM.md](apps/web/DESIGN_SYSTEM.md). PWA service worker in [apps/web/public/sw.js](apps/web/public/sw.js).
- [apps/mobile/](apps/mobile/) — Expo (expo-router, React Native) native app, also runnable as web/PWA. Mirrors the web app's screens by role (`src/app/{athlete,coach,guardian,login}`); shared client code in [apps/mobile/src/lib/](apps/mobile/src/lib/).
- [server/](server/) — Express + Mongoose API mounted under `/api/*`. Entry: [server/src/index.ts](server/src/index.ts).

**Two auth transports, one API.** The web client authenticates with **httpOnly cookies** (access token never touches JS-readable storage — see [apps/web/lib/api.ts](apps/web/lib/api.ts)). The mobile client stores tokens in **expo-secure-store** and sends the access token as a **`Bearer` header** ([apps/mobile/src/lib/api.ts](apps/mobile/src/lib/api.ts)). The server's [auth middleware](server/src/middleware/auth.ts) accepts either. Both share the same `/api/*` contract and the `scp.user` profile cache for role routing.

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

Roles: `coach | athlete | guardian` ([server/src/models/User.ts](server/src/models/User.ts)). Athletes have a separate `AthleteProfile` keyed by `userId`; coach→athlete relationships live in `CoachAthleteAssignment` (with `endedAt: null` meaning active), guardian→athlete in `GuardianAthleteLink`. Daily-card aggregation across `Attendance`, `TrainingSession`, `Wellness`, `Recovery`, `Performance`, `Injury` lives in [server/src/services/dashboard.ts](server/src/services/dashboard.ts) (`buildDailyCardsForAthletes`, `computeReadiness`, `dayRange`). Other athlete-scoped collections: `RpeMonitoring`, `WaterIntake`, `CoachComment`, `AthleteNote`, `Announcement`, `Notification`, `Message`, `WorkoutMedia`. Service layer beyond dashboard: [activity.ts](server/src/services/activity.ts), [analytics.ts](server/src/services/analytics.ts), [trends.ts](server/src/services/trends.ts), [notifications.ts](server/src/services/notifications.ts), [messaging.ts](server/src/services/messaging.ts), [achievements.ts](server/src/services/achievements.ts), [avatar.ts](server/src/services/avatar.ts), [media.ts](server/src/services/media.ts).

> **Direct messaging.** Coach⇄athlete 1:1 threads ([server/src/models/Message.ts](server/src/models/Message.ts)). A thread *is* the pair `(coachId, athleteId)` — no Conversation model. `senderRole` marks the author; a message is unread by its recipient while `readAt` is null. Coach routes live under `/api/coach/athletes/:athleteId/messages` + `/api/coach/messages/{threads,unread-count}` (gated by `requireAthleteAccess`, so assigned-only); athlete routes under `/api/athlete/messages/:coachId` + `/api/athlete/messages/{threads,unread-count}` (each validates the coach is an **active** assignment → `403 coach_not_assigned`). Sending fires a best-effort `type: "message"` notification. Delivery is **client-poll** (no WebSocket/SSE yet) — reads aren't rate-limited, sends are. Logic centralized in [messaging.ts](server/src/services/messaging.ts). Web UI: coach `/coach/messages` + `/coach/messages/[athleteId]`, athlete `/athlete/messages` + `/athlete/messages/[coachId]`, sharing [components/MessageThread.tsx](apps/web/components/MessageThread.tsx) (4s poll while open). To start a chat with someone not yet messaged, the coach uses the roster (`GET /api/coach/athletes`) and the athlete uses `GET /api/athlete/coaches`. **Mobile is partially built**: the coach screen [apps/mobile/src/app/coach/messages.tsx](apps/mobile/src/app/coach/messages.tsx) + shared [apps/mobile/src/components/MessageCenter.tsx](apps/mobile/src/components/MessageCenter.tsx) exist; the mirrored **athlete** mobile messages screen is still missing. Routers: `auth`, `coach`, `athlete`, `guardian`, `notifications` (each athlete/guardian router applies the same scope-loader + access-guard pattern, scoping to `athleteProfileId` / `linkedAthleteIds`).

> **Coach workout-media uploads.** A coach uploads a workout image for one assigned athlete (`POST /api/coach/athletes/:athleteId/media`, multipart) which is stored on disk (`WorkoutMedia` model, [server/src/models/WorkoutMedia.ts](server/src/models/WorkoutMedia.ts)) and can be converted to a structured exercise table via Gemini vision (`POST /api/coach/media/:mediaId/convert`). The converter is a swappable adapter — [services/workoutImageConverter.ts](server/src/services/workoutImageConverter.ts)'s `getWorkoutImageConverter()` returns the real Gemini implementation when `GEMINI_API_KEY` is set, otherwise a mock placeholder table, so nothing else in the codebase changes either way. A coach can edit the extracted table (`PATCH .../table`) or share the raw image with the athlete (`POST .../send`). Logic centralized in [services/media.ts](server/src/services/media.ts); uploads land under `UPLOAD_DIR` (default `./uploads`, 8 MB/file default).
>
> **Self-service avatar.** [routes/avatar.ts](server/src/routes/avatar.ts) mounts at `/api/me` gated only by `requireAuth` (no `requireRole`) since every role manages its own profile photo via `POST /api/me/avatar` (multipart) or a built-in default id. This is the one router that deliberately skips the three-role-router pattern — it's self-scoped by construction, not a coach-scope gap. A coach reads an assigned athlete's photo separately via `GET /api/coach/athletes/:athleteId/avatar/file` (still `requireAthleteAccess`-gated).
>
> **Achievements.** [services/achievements.ts](server/src/services/achievements.ts) derives a rolling streak/goal view (check-in, training, hydration, all-rounder) per athlete purely from existing `Wellness`/`TrainingSession`/`WaterIntake` data — read-only, no new writes or collections.
>
> **Production voice assistant.** An athlete's transcript is classified — never executed — by `POST /api/athlete/voice/interpret` (athlete-role only) into a structured intent via [services/voiceIntentInterpreter.ts](server/src/services/voiceIntentInterpreter.ts), the same swappable-adapter pattern as the media converter (`GEMINI_API_KEY` → real Gemini NLU, otherwise a deterministic keyword mock). The client always performs the actual write itself through the normal athlete endpoints after the user confirms — the interpreter has no database authority. UI: web [components/VoiceAssistant/useVoiceConversation.ts](apps/web/components/VoiceAssistant/useVoiceConversation.ts) + [components/AskAgentSheet.tsx](apps/web/components/AskAgentSheet.tsx), mobile [components/AskAgentControl.tsx](apps/mobile/src/components/AskAgentControl.tsx). This subsystem is under active, currently-uncommitted development — the `AskAgentSheet` UI is surfaced on all three role dashboards, but its backing `/voice/interpret` endpoint is athlete-scoped only, so verify current wiring before assuming coach/guardian voice writes work end-to-end.
>
> **`/voice-demo` sandbox ("Apex Assist").** A fully isolated product-demo sandbox inside the web workspace — no production API, MongoDB, or auth; it has its own file-backed JSON state ([apps/web/lib/voice-demo/store.ts](apps/web/lib/voice-demo/store.ts)) and its own Gemini usage (`GOOGLE_API_KEY`, in [assistantInterpreter.ts](apps/web/lib/voice-demo/assistantInterpreter.ts)/[assistantHumanizer.ts](apps/web/lib/voice-demo/assistantHumanizer.ts)) plus optional Deepgram transcription (`DEEP_GRAM`, [apps/web/app/voice-demo/api/transcribe/route.ts](apps/web/app/voice-demo/api/transcribe/route.ts)). Do not confuse its env vars or Gemini calls with the production voice assistant above — unrelated code paths that happen to share a provider. Full architecture (diagram, request flows, reliability boundaries) is in [README.md](README.md); data-model notes in [docs/voice-demo-30-day-analytics.md](docs/voice-demo-30-day-analytics.md).

### Tests

Jest + ts-jest + `mongodb-memory-server` (no external Mongo needed). Tests live in [server/tests/](server/tests/) and cover access control, the coach dashboard, athlete/guardian workspaces, RPE/readiness, analytics, trends, onboarding, avatar uploads, workout-media (incl. the Gemini-adapter mock path), and voice-intent interpretation end-to-end. There are **no** web/mobile test suites — guard those workspaces with `npm run typecheck`.

## Deployment

Split-monorepo deploy to **Google Cloud Run** via [deploy.bat](deploy.bat) (two services, `scp-server` + `scp-web`, each from its own `Dockerfile`). Ordering is load-bearing: the web bundle inlines the API URL at build time, so the script deploys the API first → reads its URL → builds/deploys web with that URL baked in → finally points the API's `CORS_ORIGIN` at the deployed web origin. Server secrets come from `env.server.yaml` (copy `env.server.yaml.example`). For local full-stack, [docker-compose.yml](docker-compose.yml) brings up Mongo + API + web. Cloud Run egress must be allow-listed in MongoDB Atlas (see memory: Atlas is the active DB and rejects non-whitelisted IPs).

## Project blueprint

The full design (architecture, schema, RBAC matrix, API contract, UI flows, step-by-step plan) lives in [skills/sports-coaching-platform-builder/](skills/sports-coaching-platform-builder/). Consult it before adding new collections, endpoints, or pages — the existing code follows it and new code should too.
