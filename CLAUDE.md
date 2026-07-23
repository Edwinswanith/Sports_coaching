# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root (npm workspaces).

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Run server + Expo mobile in parallel (`predev` runs `scripts/dev-clean.mjs`) |
| `npm run dev:server` | Express dev via ts-node-dev (http://localhost:4000) |
| `npm run dev:mobile` | Expo dev server for the native/PWA app (`mobile`) |
| `npm run build` | Build server |
| `npm run typecheck` | `tsc --noEmit` across server + mobile (or `typecheck:server` / `:mobile`) |
| `npm test` / `npm test --workspace server` | Run server Jest suite (uses `mongodb-memory-server`, `--runInBand`) |
| `npx jest tests/coach-dashboard.test.ts --workspace server` | Run a single server test file |
| `npm run lint --workspace mobile` | ESLint for mobile |
| `npm run seed --workspace server` | Run `server/src/scripts/seed.ts` |
| `npm run create-owner --workspace server` | Bootstrap the first academy-owner coach (no in-app path exists) |
| `npm run test:e2e` (`:ui`, `:install`) | Playwright e2e for the mobile Ask Agent flow ([e2e/](e2e/)) — boots server + Expo web via `webServer` and mocks `SpeechRecognition` (no real audio/Deepgram) |

Env setup: copy `.env.example` to `.env` and `server/.env`. Server reads env via [server/src/config/env.ts](server/src/config/env.ts) (`MONGODB_URI`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `GOOGLE_CLIENT_ID` — comma-separated client IDs; empty disables Google sign-in). When `MONGODB_URI` is non-local, the server **refuses to start** unless the JWT secrets are non-placeholder (`strictSecrets`). Mobile reads `EXPO_PUBLIC_API_BASE_URL` (defaults to the deployed Cloud Run API). Optional server-side `GEMINI_API_KEY`/`GEMINI_MODEL` power workout-image conversion, voice-intent NLU, voice translation, and guided-tour narration (mock/static fallback when unset — see below). Optional server-side `DEEP_GRAM` (+ `DEEPGRAM_STT_MODEL`/`DEEPGRAM_TTS_MODEL`/`DEEPGRAM_STREAM_ENDPOINTING_MS`/`DEEPGRAM_STREAM_UTTERANCE_END_MS`) powers the production Ask Agent's speech-to-text/text-to-speech (503s when unset — see below).

## Architecture

Monorepo (npm workspaces: `mobile` + `server`) with two client workspaces:
- [mobile/](mobile/) — Expo (expo-router, React Native) native app, also runnable as web/PWA. Screens by role in `src/app/{athlete,coach,guardian,login}`; shared client code in [mobile/src/lib/](mobile/src/lib/).
- [server/](server/) — Express + Mongoose API mounted under `/api/*`. Entry: [server/src/index.ts](server/src/index.ts).

**Mobile auth.** The mobile client stores tokens in **expo-secure-store** and sends the access token as a **`Bearer` header** ([mobile/src/lib/api.ts](mobile/src/lib/api.ts)). The server's [auth middleware](server/src/middleware/auth.ts) also accepts httpOnly cookies for legacy clients. Both share the same `/api/*` contract and the `scp.user` profile cache for role routing.

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

> **Direct messaging.** Coach⇄athlete 1:1 threads ([server/src/models/Message.ts](server/src/models/Message.ts)). A thread *is* the pair `(coachId, athleteId)` — no Conversation model. `senderRole` marks the author; a message is unread by its recipient while `readAt` is null. Coach routes live under `/api/coach/athletes/:athleteId/messages` + `/api/coach/messages/{threads,unread-count}` (gated by `requireAthleteAccess`, so assigned-only); athlete routes under `/api/athlete/messages/:coachId` + `/api/athlete/messages/{threads,unread-count}` (each validates the coach is an **active** assignment → `403 coach_not_assigned`). Sending fires a best-effort `type: "message"` notification. Delivery is **client-poll** (no WebSocket/SSE yet) — reads aren't rate-limited, sends are. Logic centralized in [messaging.ts](server/src/services/messaging.ts). Mobile UI: coach [mobile/src/app/coach/messages.tsx](mobile/src/app/coach/messages.tsx) + shared [mobile/src/components/MessageCenter.tsx](mobile/src/components/MessageCenter.tsx); the mirrored **athlete** mobile messages screen is still missing. Routers: `auth`, `coach`, `athlete`, `guardian`, `notifications` (each athlete/guardian router applies the same scope-loader + access-guard pattern, scoping to `athleteProfileId` / `linkedAthleteIds`).

> **Coach workout-media uploads.** A coach uploads a workout image for one assigned athlete (`POST /api/coach/athletes/:athleteId/media`, multipart) which is stored on disk (`WorkoutMedia` model, [server/src/models/WorkoutMedia.ts](server/src/models/WorkoutMedia.ts)) and can be converted to a structured exercise table via Gemini vision (`POST /api/coach/media/:mediaId/convert`). The converter is a swappable adapter — [services/workoutImageConverter.ts](server/src/services/workoutImageConverter.ts)'s `getWorkoutImageConverter()` returns the real Gemini implementation when `GEMINI_API_KEY` is set, otherwise a mock placeholder table, so nothing else in the codebase changes either way. A coach can edit the extracted table (`PATCH .../table`) or share the raw image with the athlete (`POST .../send`). Logic centralized in [services/media.ts](server/src/services/media.ts); uploads land under `UPLOAD_DIR` (default `./uploads`, 8 MB/file default). Distinct from this: a coach can also attach a photo directly to one AM/PM session's notes (`POST /api/coach/athletes/:athleteId/training/:slot/photos`, embedded `photos[]` on `TrainingSession` — see [models/TrainingSession.ts](server/src/models/TrainingSession.ts)) — that's visible immediately with no convert/send gate, unlike `WorkoutMedia`.
>
> **Self-service avatar.** [routes/avatar.ts](server/src/routes/avatar.ts) mounts at `/api/me` gated only by `requireAuth` (no `requireRole`) since every role manages its own profile photo via `POST /api/me/avatar` (multipart) or a built-in default id. This is the one router that deliberately skips the three-role-router pattern — it's self-scoped by construction, not a coach-scope gap. A coach reads an assigned athlete's photo separately via `GET /api/coach/athletes/:athleteId/avatar/file` (still `requireAthleteAccess`-gated).
>
> **Achievements.** [services/achievements.ts](server/src/services/achievements.ts) derives a rolling streak/goal view (check-in, training, hydration, all-rounder) per athlete purely from existing `Wellness`/`TrainingSession`/`WaterIntake` data — read-only, no new writes or collections.
>
> **Production voice assistant ("Ask Agent").** An athlete's transcript is classified — never executed — by `POST /api/athlete/voice/interpret` (athlete-role only) into a structured intent via [services/voiceIntentInterpreter.ts](server/src/services/voiceIntentInterpreter.ts), the same swappable-adapter pattern as the media converter (`GEMINI_API_KEY` → real Gemini NLU, otherwise a deterministic keyword mock). The client always performs the actual write itself through the normal athlete endpoints after the user confirms — the interpreter has no database authority. Speech I/O is a separate, role-agnostic layer gated only by `requireAuth` ([routes/voice.ts](server/src/routes/voice.ts)): `POST /api/voice/transcribe` (batch Deepgram STT upload), `GET`/`POST /api/voice/speak` (Deepgram TTS), `POST /api/voice/translate` (Gemini command/reply translation for non-English speech). Live mic input instead streams over a WebSocket proxy at `/api/voice/stream` ([routes/voiceStream.ts](server/src/routes/voiceStream.ts), attached to the same HTTP server via `attachVoiceStreamProxy` in [index.ts](server/src/index.ts) using the `ws` package) — auth is a bearer header or `?token=` query param (React Native can't set WS headers), it proxies PCM audio to Deepgram's live endpoint, normalizes events to `interim`/`final`/`utterance_end`/`error`, caps at one concurrent stream per user, and enforces 30s idle/max timeouts; the mobile client falls back to the batch route on failure. UI: mobile [lib/voiceSession.ts](mobile/src/lib/voiceSession.ts) (conversation loop + streaming/batch STT), [lib/agentSpeech.ts](mobile/src/lib/agentSpeech.ts) (TTS), [lib/voiceLanguage.ts](mobile/src/lib/voiceLanguage.ts) + [lib/voiceTranslation.ts](mobile/src/lib/voiceTranslation.ts) (persisted language preference + translation), [components/AskAgentControl.tsx](mobile/src/components/AskAgentControl.tsx). This subsystem is under active development — the Ask Agent UI is surfaced on all three role dashboards, but the NLU `/voice/interpret` endpoint is athlete-scoped only, so verify current wiring before assuming coach/guardian voice writes work end-to-end.
>
> **Guided tour narration.** [routes/tour.ts](server/src/routes/tour.ts) mounts at `/api/tour`, gated only by `requireAuth` like `routes/avatar.ts` — the guided tour is identical across roles, so it isn't duplicated per role router. `POST /api/tour/narrate` rephrases one static tour step's copy through [services/tourNarrator.ts](server/src/services/tourNarrator.ts) (Gemini when `GEMINI_API_KEY` is set) and always falls back to the caller-supplied static `fallbackNote` on any failure — the tour must never break the app. Mobile: [lib/tour/MobileTourProvider.tsx](mobile/src/lib/tour/MobileTourProvider.tsx) + [lib/tour/tourNarration.ts](mobile/src/lib/tour/tourNarration.ts).

### Tests

**Server:** Jest + ts-jest + `mongodb-memory-server` (no external Mongo needed). Tests live in [server/tests/](server/tests/) and cover access control, the coach dashboard, athlete/guardian workspaces, RPE/readiness, analytics, trends, onboarding, avatar uploads, workout-media + session photos, messaging, guided-tour narration (incl. the Gemini-adapter mock paths), and voice-intent interpretation end-to-end.

**Mobile:** no test suite — guard it with `npm run typecheck:mobile` only.

**e2e:** [e2e/](e2e/) has a Playwright suite (`npm run test:e2e`) that drives the **mobile** app's Expo-web build against a real server for the Ask Agent voice flow across all three roles (mocks `SpeechRecognition`, not real audio/Deepgram/Gemini).

## Deployment

Split-monorepo deploy to **Google Cloud Run** via [deploy.bat](deploy.bat) (two services, `scp-server` + `scp-web`, each from its own `Dockerfile`). Ordering is load-bearing: the mobile web bundle inlines the API URL at build time, so the script deploys the API first → reads its URL → builds/deploys mobile web with that URL baked in → finally points the API's `CORS_ORIGIN` at the deployed web origin. Server secrets come from `env.server.yaml` (copy `env.server.yaml.example`). For local full-stack, [docker-compose.yml](docker-compose.yml) brings up Mongo + API + mobile web export. Cloud Run egress must be allow-listed in MongoDB Atlas (see memory: Atlas is the active DB and rejects non-whitelisted IPs).

## Project blueprint

The full design (architecture, schema, RBAC matrix, API contract, UI flows, step-by-step plan) lives in [skills/sports-coaching-platform-builder/](skills/sports-coaching-platform-builder/). Consult it before adding new collections, endpoints, or pages — the existing code follows it and new code should too.
