# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project Overview

This is a sports coaching platform with a monorepo layout:

- `apps/web/` - Next.js App Router frontend with TypeScript and Tailwind CSS.
- `server/` - Express + TypeScript API using MongoDB via Mongoose.
- `docs/` - Engineering docs.
- `skills/sports-coaching-platform-builder/` - Project blueprint: architecture, RBAC, API contract, schema, UI flow, and implementation plan.

The repository may be present as a local project snapshot without `.git`.

## Commands

Run commands from the repository root unless noted.

- `npm install` - Install all workspaces.
- `npm run dev` - Run web and server in parallel.
- `npm run dev:web` - Run Next.js dev server at `http://localhost:3000`.
- `npm run dev:server` - Run Express dev server at `http://localhost:4000`.
- `npm run build` - Build web and server.
- `npm test --workspace server` - Run server Jest tests using `mongodb-memory-server`.
- `npx jest tests/coach-dashboard.test.ts --workspace server` - Run one server test file.
- `npm run seed --workspace server` - Run `server/src/scripts/seed.ts`.

Environment setup:

- Copy `.env.example` to `.env`.
- Copy `.env.example` to `server/.env`.
- Copy `apps/web/.env.example` to `apps/web/.env.local` if that file exists.

Server env is read from `server/src/config/env.ts` and includes `MONGODB_URI`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, and `JWT_REFRESH_TTL`.

## Core Invariant: Coach Scope

A coach must only see data for athletes explicitly assigned to that coach.

This is enforced in three layers:

1. JWT auth in `server/src/middleware/auth.ts` verifies the access token and sets `req.actor = { userId, role }`.
2. Scope loading and athlete authorization in `server/src/middleware/coachAthleteAccess.ts` populates actor scope and validates athlete access.
3. Route role gates in `server/src/middleware/role.ts` run before scope-sensitive routers.

Coach-scoped routers should follow this pattern:

```ts
router.use(requireAuth, requireRole("coach"), loadScope);
router.get("/athletes/:athleteId/...", requireAthleteAccess("athleteId"), handler);
```

When adding coach endpoints, never query athlete-scoped collections without first restricting to `req.actor.assignedAthleteIds` or using `requireAthleteAccess` for single-athlete routes.

## Domain Notes

User roles are `coach`, `athlete`, and `guardian`.

Athletes have separate `AthleteProfile` records keyed by `userId`. Coach-athlete relationships live in `CoachAthleteAssignment`; active assignments have `endedAt: null`. Guardian-athlete relationships live in `GuardianAthleteLink`.

Daily dashboard aggregation across attendance, training, wellness, recovery, performance, and injuries lives in `server/src/services/dashboard.ts`.

## Implementation Guidance

- Consult `skills/sports-coaching-platform-builder/` before adding collections, endpoints, or pages.
- Keep frontend changes consistent with the existing Next.js + Tailwind setup.
- Keep backend changes aligned with the existing Express router, middleware, model, and service structure.
- Add or update focused tests for access-control-sensitive backend changes.
- Do not weaken the coach-scope invariant, even for temporary scaffolding.
