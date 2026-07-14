# 30-day athlete analytics and coach-planning demo

## Scope

`/voice-demo` is a synthetic, local, authentication-free product demo. It does not read or write production athlete data. The current milestone is text-first; microphone recording and Deepgram transcription remain deferred until the text workflow is reliable.

## Data model

The local JSON state uses schema version `2` and a canonical `days` collection covering 13 June through 12 July 2026. An incompatible state file is replaced with the deterministic seed rather than partially migrated. Manual and assistant updates always target the day matching `athlete.dateKey`.

Readiness is calculated as:

```text
round(average(sleep quality, mood, 11 - soreness, 11 - fatigue) × 10)
```

Session load is calculated as:

```text
actual duration in minutes × effort rating
```

Lower values are better for sprint and timed-carry benchmarks. Higher values are better for vertical jump.

## Assistant boundaries

Gemini maps language to a typed candidate query or write action. Deterministic application code calculates periods, averages, deltas, rankings, priorities, coach-plan visibility, and every displayed evidence value.

Open-ended questions use a constrained conversational-analytics pipeline:

1. Gemini or a deterministic fast path selects `analyze_athlete_data` and produces a typed query goal, allowlisted metrics, and a bounded date range.
2. The server rejects unknown fields, metrics, dates, ranges, and ambiguous relationship queries.
3. The deterministic executor reads the canonical day history and calculates rankings, trends, period comparisons, paired observations, and relationships.
4. The executor returns evidence records and immutable grounding tokens such as `{{E1}}`.
5. Gemini may rewrite the fallback response using only those tokens. Free numeric claims, unknown tokens, causal language, diagnoses, and prescriptions cause the response to fall back to the deterministic version.

No day stores a “best,” “worst,” or “poor performance” label. Difficult or strong patterns are derived when requested, with the comparison signals disclosed. The incomplete active day is excluded from historical day ranking so unfinished reporting is not treated as poor performance. Relationships are described as associations and never as proof of cause.

Read-only analytics never create assistant plans, operations, or athlete records. Athlete writes still require a preview and explicit confirmation. Conversation context contains only validated structured references and lives in browser memory until refresh or reset.

The assistant may explain a published prescription and compare it with historical evidence. It never independently prescribes a workout or increases volume, load, or target RPE. Coach Priya remains the sole authority for those changes.

The Test Laboratory displays the validated analytics query, data coverage, grounding count, safety decision, and whether Gemini humanization passed validation or used the deterministic fallback.

## Coach plan lifecycle

Coach plans use draft-then-publish:

1. Create a private draft from the current published plan.
2. Edit title, focus, duration, exercises, volume, load, target RPE, and rest.
3. Save without changing the athlete-visible plan.
4. Validate and publish the next version.
5. Athlete dashboard and assistant queries immediately use the latest published version.

Publishing validates sets, repetitions or distance, load, target RPE, rest, duration, exercise identity, title, focus, date, and slot. Errors identify the invalid field.

## Local use

From the repository root:

```bash
npm run dev:web
```

Open [http://localhost:3000/voice-demo](http://localhost:3000/voice-demo).

Run validation with:

```bash
npm test --workspace apps/web -- --runInBand
npm run typecheck:web
npm run test:assistant-live --workspace apps/web
npm run build:web
git diff --check
```

The live assistant matrix uses the configured server-side Gemini key. API keys must remain in the ignored root `.env` and must never use a `NEXT_PUBLIC_` variable.
