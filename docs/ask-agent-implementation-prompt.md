# Implementation Prompt: "Ask Agent" — Voice & Text Command Assistant

Use this document as the full task brief for an agent or developer implementing a voice/text
command assistant ("Ask Agent") in an app. It covers three capabilities: **redirect**
(in-app navigation), **add/update data** (guarded CRUD via natural language), and
**generate report & suggestion** (grounded analytics + advice, never hallucinated).

This spec generalizes a working production pattern — adapt the placeholders
(`<your ...>`) to your actual stack and domain. Nothing here assumes a specific framework;
follow the *responsibilities* of each layer, not literal file paths.

---

## Copy-paste prompt (start here)

```
Implement an "Ask Agent" voice + text command assistant for <your app name>.

## Goal

A user can speak or type a command and the app will either:
1. Navigate them to the right screen/section ("redirect"),
2. Create or update a record after the user confirms ("add/update data"), or
3. Answer an analytics question or give a suggestion, grounded entirely in real
   data the app already has — never a number the model invented ("report & suggestion").

## Non-negotiable design rules

1. **The NLU layer never touches the database.** It only classifies intent and extracts
   structured fields from the transcript. The actual write happens through the app's
   existing normal CRUD endpoints/mutations, called by the client only after the user
   confirms. If you remove the NLU layer entirely, every other write path in the app must
   keep working unchanged — that's the test for whether the separation is real.
2. **Every write intent requires explicit confirmation** unless the caller opts into
   auto-confirm for a specific low-risk field. Confirmation yes/no is parsed with a fixed
   keyword matcher, not a second model call — a talkative "well actually no wait yes"
   transcript must not be able to talk the system into skipping confirmation.
3. **Reports/suggestions never let the model state a number, date, or fact that didn't
   come from a real query.** The model may only rephrase/format pre-computed values you
   hand it, wrapped in tokens it must echo back verbatim (pattern in Layer 5). Reject and
   fall back to a deterministic template if validation fails.
4. **The interpreter is a swappable adapter.** Define one interface
   (`interpret(transcript, context) -> IntentResult`) with a real LLM-backed implementation
   and a deterministic keyword/regex mock implementation behind the same interface, chosen
   by an env var. Local dev, CI, and tests must run with zero network calls and zero API
   keys via the mock.
5. **Idempotent writes.** Every write carries a client-generated `operationId`. The
   handler must be a no-op (return the prior result) on a retried `operationId` — voice
   sessions retry on flaky connections and must never double-submit.
6. **Everything is scoped to the authenticated user's own data.** The agent must never
   accept a client-supplied "whose record" field for a write — resolve the owner from the
   authenticated session server-side, the same way every other write endpoint in the app
   already does.

## Scope for this task

- [ ] Speech I/O layer (transcribe, synthesize, optional streaming)
- [ ] Intent interpreter (schema-constrained LLM + deterministic mock, swappable)
- [ ] Conversation/confirmation state machine (client-side)
- [ ] Execution layer wired to existing CRUD endpoints (not a new "AI can write anything" endpoint)
- [ ] Report/suggestion pipeline: deterministic data aggregation → grounded generation → validation
- [ ] Tests for the mock interpreter path and the confirmation/execution state machine

Read the full spec below before writing code — it defines the intent taxonomy, the
confirmation state machine, the grounding-token pattern for reports, and the security
checklist in detail.
```

---

## Context

Monorepo or single app — doesn't matter. What matters is that the app already has:
- An authenticated API (or equivalent server boundary) with existing CRUD operations for
  its core entities.
- A concept of "screens/sections" a user navigates between (routes, tabs, whatever).
- Some data worth reporting on (time-series, logs, records — anything a user might ask
  "how am I doing" or "what should I do next" about).

If any of those don't exist yet, build them first through the app's normal path — the Ask
Agent is a new *interface* onto existing capabilities, not a shortcut to skip building them.

---

## Architecture

Five layers, each independently testable and independently replaceable:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Speech I/O           mic → transcript, text → speech, translation │
├─────────────────────────────────────────────────────────────────────┤
│ 2. Intent Interpreter   transcript → { intent, fields, missing }     │
│                         (swappable adapter: real LLM | deterministic)│
├─────────────────────────────────────────────────────────────────────┤
│ 3. Conversation Engine  slot-filling, confirmation, cancel — client  │
├─────────────────────────────────────────────────────────────────────┤
│ 4. Execution            calls the SAME endpoints a human-driven UI   │
│                         action would call; idempotent; scoped to user│
├─────────────────────────────────────────────────────────────────────┤
│ 5. Report/Suggestion    deterministic aggregation → grounded LLM     │
│                         rephrasing, validated against source facts   │
└─────────────────────────────────────────────────────────────────────┘
```

Layer 2 has no authority over layers 4/5's data — it only proposes. Layer 3 (running on
the client, or a thin per-session server state) is what actually decides whether to ask a
follow-up, ask for confirmation, or execute. This separation is the whole point: a bad or
adversarial transcript can make the NLU layer say anything, but it can never cause an
unconfirmed write, because the write path doesn't trust layer 2's word for it — it trusts
the confirmation state machine, which is deterministic app code.

---

## Layer 1 — Speech I/O

### Transcription (speech → text)

Two tiers, both behind the same auth boundary as the rest of the API:

- **Batch**: client records a short clip, uploads it (multipart), server proxies to an STT
  provider, returns `{ transcript }`. Simple, works everywhere, adds \~1-2s latency per turn.
- **Streaming** (recommended for the "full production-grade" experience): client opens a
  WebSocket to the server; server proxies raw PCM audio frames to the STT provider's live
  endpoint and normalizes provider events into a small stable contract:

  ```
  { type: "interim",       transcript: string }   // still being spoken
  { type: "final",         transcript: string }   // one phrase settled
  { type: "utterance_end", transcript: string }   // speaker paused — treat as "done", act now
  { type: "error",         code: string, message: string }
  ```

  Server-side WS proxy responsibilities:
  - Auth on connect (bearer header if available; **query-string token as fallback** — some
    native clients can't set WS headers).
  - **One concurrent stream per user** — reject a second connection while one is active.
  - Per-user rate limit on new stream connections (e.g. 30/min).
  - Idle timeout (no audio for N seconds → close) and max-duration timeout (hard cap on a
    single session, e.g. 30-60s) — both independent of whatever the upstream provider does.
  - Buffer audio frames that arrive before the upstream connection finishes opening (small
    ring buffer, e.g. cap 64 chunks) instead of dropping them.
  - Clean up the upstream connection on client disconnect and vice versa — no orphaned
    provider sessions.
  - Client falls back to the batch endpoint automatically if the streaming connection fails
    to establish or errors out mid-session — never dead-end the user.

### Text-to-speech (text → speech)

`POST /speak { text }` → audio bytes, `Cache-Control: no-store`. Cap input length
server-side (e.g. 2000 chars) — this endpoint will receive whatever the report/suggestion
layer produces, so bound it defensively.

### Multi-language (optional, only if your users need it)

Two small, separable pieces — don't conflate them:
1. **Command translation**: non-English transcript → English before it reaches the
   interpreter (Layer 2 only needs to understand one language). Preserve numbers, proper
   nouns, and domain-specific terms explicitly in the translation instruction.
2. **Reply translation**: English spoken response → the user's chosen language before TTS.

Both are simple grounded translation calls (temperature 0, "translate this, preserve
numbers/names, return only the translation") — not part of the intent/report logic. Skip
translation entirely (return the input unchanged) when source == target language or the
translation provider isn't configured — never block the turn on it.

### Conversation loop (client)

State machine per turn: `listen → (silence/end-of-speech detected) → send transcript →
await interpreter result → speak reply → listen again`. Concretely:
- A **silence/inactivity timeout** that ends the whole session if the user goes quiet for
  too long (not per-utterance — across the whole "conversation"), resetting on real speech
  activity (volume above a small noise floor), not just on any audio frame.
- Each listen attempt is tagged with a sequence number; stale callbacks from a
  superseded attempt (e.g. after a timeout restarted listening) are ignored by comparing
  the sequence number, not by hoping timers cancel in order.
- On transcription failure/empty result: brief recovery — if the deadline hasn't passed,
  quietly restart listening; if it has, surface a timeout and stop (don't spin forever).
- While the agent is speaking a reply, don't listen — resume listening a short debounce
  after playback ends (e.g. 300ms) so the mic doesn't pick up the tail of the TTS audio.
- Speech I/O has an explicit "needs fallback" signal (no mic permission, no speech API in
  this browser/environment, SSR) distinct from "error" — route it to a text-input fallback,
  not a retry loop.

---

## Layer 2 — Intent Interpreter

### Interface

```
interpret(input: {
  transcript: string
  context: <whatever server-known facts the model needs — e.g. "today's date">
  pendingIntent?: { intent, collected: Record<string, unknown>, missingFields: string[] }
}) -> {
  intent: IntentName
  fields: Record<string, unknown>
  missingFields: string[]
  followUpQuestion?: string     // only if missingFields is non-empty
  requiresConfirmation: boolean // computed by YOUR code from a hardcoded intent list,
                                 // never returned by the model — see rule below
  spokenResponse: string        // short ack; for report/query intents this MUST NOT
                                 // contain any number/fact — see Layer 5
}
```

`requiresConfirmation` is **application policy, not a model decision** — maintain a
hardcoded list of which intents are writes and derive it from that list server-side. Never
let the model's output field decide whether a write skips confirmation.

### Intent taxonomy

Design your intents around the three capabilities:

| Category | Example intents | requiresConfirmation |
|---|---|---|
| Redirect | `navigate` | No |
| Query/Report | `query_status`, `generate_report`, `get_suggestion` | No (read-only) |
| Add/Update | `create_<entity>`, `update_<entity>`, `add_<log-type>` | **Yes** |
| Fallback | `unsupported` | No |

Keep the field schema for each intent explicit and typed (enum where possible, not free
text) — e.g. a status field should be `enum: ["done", "skipped", "in_progress"]`, not a
free string the execution layer has to guess-parse. Document, in the field descriptions
themselves (they go straight into the model's schema/prompt), exactly what scale numeric
fields use (e.g. "1-10 spoken scale" vs. the app's internal "1-5 stored scale") and any
synonym collapsing (e.g. three different phrasings that should all populate the same
single field) — this is where most real-world NLU bugs live, not in the model choice.

### Real implementation (LLM-backed)

- **Structured output only** — use your provider's JSON-schema-constrained generation mode
  (function calling / response schema), `temperature: 0`. Don't parse free text.
- System prompt explicitly says: extract only fields that were said or unambiguously
  implied, **never invent a number**; if a required field is missing, return it in
  `missingFields` with a natural `followUpQuestion` instead of guessing.
- Sanitize the raw model response before trusting it: intent must be in your known enum
  (else force `unsupported`), array/enum fields filtered to allowed values, unknown/absent
  fields defaulted safely. Never trust the model's JSON as pre-validated just because you
  asked for a schema.

### Mock implementation (deterministic)

A keyword/regex classifier implementing the exact same interface. This is not a toy — it's
what runs in local dev, CI, and every test, so it needs to cover your product's common
phrasings well enough to exercise the full route contract end-to-end. Anything it can't
confidently classify returns `unsupported` rather than guessing.

### Adapter resolution

```
getIntentInterpreter() {
  return env.LLM_API_KEY ? new RealInterpreter(...) : new MockInterpreter()
}
```

One choke point, memoized. A test-only setter to inject a fake implementation. Nothing
else in the codebase imports a concrete class — only the interface.

### Multi-turn slot filling

When `missingFields` is non-empty, the caller stores `{ intent, collected, missingFields }`
as `pendingIntent` and sends it back on the *next* turn along with the new transcript. The
interpreter merges newly-stated fields into `collected` and only asks about what's still
missing. Cap this — don't loop forever if the user keeps not answering; after N attempts,
say so and drop back to idle.

---

## Layer 3 — Conversation & Confirmation Engine

Lives on the client (or a short-lived per-session server object — client is simpler and is
what's described here). Pure state machine, no model calls for confirmation itself:

```
handleTranscript(transcript):
  if pending confirmation exists:
    if isAffirmative(transcript):  runWrite(pending); return
    if isNegative(transcript):     cancel(); return
    # else: fall through — treat as a fresh command (user changed their mind mid-question)

  if no in-progress multi-turn intent:
    # fast local path for common phrasings — skip the network round-trip entirely
    if localNavIntent(transcript): navigate(); return

  result = interpreter.interpret(transcript, pendingIntent)

  if result.intent == navigate:        navigate(result.fields.target); clear pending; return
  if result.intent == query/report:    say(deterministicallyBuiltAnswer(...)); clear pending; return
  if result.intent == unsupported:     say(result.spokenResponse); clear pending; return

  if result.missingFields.length > 0:
    store as pendingIntent; ask result.followUpQuestion; return

  clear pendingIntent
  if result.requiresConfirmation and not autoConfirm:
    summary = summarize(result.intent, collectedFields)   # YOUR deterministic template,
                                                            # not model-authored
    show/say summary; store as pendingConfirmation; return
  else:
    runWrite(result.intent, collectedFields)
```

`isAffirmative` / `isNegative` are **fixed keyword regexes** (yes/yeah/confirm/do it vs.
no/cancel/stop/nevermind), evaluated locally — this is rule 2 from the copy-paste prompt.
`summarize()` is a template per intent (`"Log ${amountMl} ml of water?"`) — never let the
model phrase the confirmation prompt, since that's the last checkpoint before a write.

---

## Layer 4 — Execution (the actual write)

The confirmed `(intent, fields)` pair is translated into a call to **the same
create/update function or endpoint a normal UI button already calls.** Concretely: one
`switch (intent)` that maps each write intent to one existing action/mutation, with light
type coercion/defaulting of the extracted fields (e.g. `Number(fields.mood ?? default)`,
validate enums, drop anything unrecognized). This function is the *only* place that decides
which endpoint an intent maps to — keep it colocated with Layer 3, not duplicated per
platform if you can help it.

Rules:
- **No new "AI write" endpoint.** If your create/update logic ever needs to change (new
  validation, new required field), it changes in exactly one place — the endpoint the
  normal UI already uses — and the agent path picks it up for free.
- **Idempotency key.** Every write call carries a client-generated `operationId`
  (`^[a-zA-Z0-9_-]{8,100}$` or similar). Server-side, check-then-insert: if an operation
  with that ID was already applied, return the prior result unchanged (`{ changed: false }`)
  instead of re-applying. This is what makes "network blipped, client retried" safe.
- **Server resolves ownership, never the client.** The write handler reads "whose record"
  from the authenticated session (the same scope-resolution your normal endpoints already
  do), not from a client-supplied ID — even though the voice layer "knows" who's talking,
  don't let it assert an identity the server doesn't independently verify.
- On success: refresh whatever local state the UI shows, say a short deterministic
  confirmation (`"${label} saved."`), clear pending state.
- On failure: say a short deterministic failure message, do **not** silently retry the
  write on the user's behalf.

---

## Layer 5 — Report & Suggestion Generation

This is the capability most prone to hallucination if built naively ("hey, just ask the
LLM about the user's data") — don't do that. Use a **grounding-token** pattern:

### Step 1 — Deterministic aggregation (plain code, no LLM)

Compute whatever the user asked about from real stored data: totals, trends, comparisons,
whatever your domain needs. This is ordinary application logic — a function that takes
your data model and returns numbers/derived facts. No model involvement.

### Step 2 — Emit grounding facts, not a paragraph

Turn the computed values into a small list of labeled facts:

```
[
  { id: "E1", label: "readiness today",        value: "72/100" },
  { id: "E2", label: "sleep last night",        value: "6.5 hours" },
  { id: "E3", label: "7-day training load avg", value: "340" },
]
```

### Step 3 — Deterministic fallback message

Build a plain-template sentence from the same facts (`"Readiness is 72/100, sleep was 6.5
hours."`). This is what you show if generation is unavailable, disabled, or fails
validation — the feature must degrade to something correct-but-plain, never to nothing or
to an ungrounded free-text answer.

### Step 4 — Optional LLM rephrasing, token-constrained

If you want the answer to sound conversational, send the model:
- the user's original question,
- the deterministic fallback message,
- the grounding facts as `{{E1}} = readiness today: 72/100` lines,

and instruct it to:
- write a natural sentence, but **represent every fact/number with its `{{E#}}` token**,
  written naturally right before the token (e.g. "Readiness today is {{E1}}.") — never
  restate or paraphrase the value itself,
- use **no digits anywhere outside a token**,
- reference **only the metrics present in the supplied facts** — nothing else,
- use associative, non-causal language ("coincided with", not "caused by") if relating two
  signals,
- avoid diagnostic or prescriptive phrasing for anything sensitive (no "you should",
  "you must", "increase your X", no diagnosing a cause) — keep suggestions to what your
  domain and liability tolerance actually allow,
- return strict JSON, `temperature: 0`.

### Step 5 — Validate before trusting the output, every time

Reject the candidate (fall back to Step 3's plain message) if **any** of:
- empty, or over your length cap,
- matches an unsafe-language regex (causal claims, diagnoses, imperative prescriptions —
  whatever your domain's version of "don't say this" is),
- contains **zero** `{{E#}}` tokens, or references a token not in your fact map,
- contains any digit character outside of a resolved token,
- mentions a metric/topic by name that isn't backed by one of the supplied facts,
- after substituting tokens with real values, any `{{E#}}` placeholder remains unresolved.

Only if it survives every check do you substitute the tokens with real values and return
it. This validator is what makes the "optional LLM polish" pass safe to ship — it cannot
introduce a fact, because a fact that isn't a pre-approved token is either rejected outright
or literally can't appear (no free digits allowed).

### Handling open-ended questions (not just fixed report types)

For a fixed dashboard ("how am I doing today") the flow above is enough. For open-ended
questions ("compare last two weeks", "what should I focus on"), add a **candidate + plan**
step between transcript and aggregation:

1. The interpreter proposes 1-N *candidate* structured queries (which metric, which date
   range, which comparison) with a confidence/label each — still schema-constrained, still
   no free-text answer from the model at this stage.
2. A deterministic resolver picks the best candidate (exact match on an explicit reference
   in the transcript, or the single unambiguous candidate) or, if genuinely ambiguous, asks
   a clarifying question instead of guessing (same `missingFields`/`followUpQuestion`
   mechanism as Layer 2).
3. The resolved query is executed by plain code against real data (Step 1 above) and the
   result flows through Steps 2-5 as normal.

This keeps "what is the user asking about" (fuzzy, LLM's job) cleanly separated from "what
did we find" (exact, plain code's job) and "how do we phrase it" (constrained, validated).

### Suggestions specifically

A "suggestion" is a report answer whose grounding facts happen to include a
recommendation-relevant metric (e.g. "you're trending low on X") plus a **pre-approved,
deterministic action mapping** — e.g. "if metric X is below threshold Y, the allowed
suggestion pool includes {A, B, C}" — written in your own code, not generated. The LLM's
job stays limited to picking phrasing from grounded facts, never to inventing what the
suggestion *is*. If your domain requires more open-ended coaching-style advice, treat that
as an explicit, separate, clearly-labeled "AI opinion" surface with its own disclaimers —
don't blend it silently into the grounded-report surface.

---

## Redirect / Navigate — details

- Keep a small static map of `keyword → target` (section id, tab, or route) and try a fast
  local match (`"open X"`, `"show X"`, `"go to X"`) **before** calling the interpreter at
  all — this is the highest-frequency intent and shouldn't cost a network round trip.
- Fall back to the interpreter for anything the local map misses (natural phrasing without
  the "open/show/go to" prefix, synonyms).
- `navigate` never requires confirmation — it's non-destructive by definition.
- The target enum in your schema should be an exhaustive list of actual navigable
  destinations, not a free string — the execution side just does a lookup, no parsing.

---

## Add / Update Data — details

For each write intent you support, define explicitly (this doubles as your interpreter
schema documentation and your execution-layer switch case):

- Which fields are required vs. optional, and their types/enums/ranges.
- What scale/units the *spoken* value uses vs. what the *stored* value uses, and the exact
  conversion (don't leave this implicit — it's the #1 source of silently-wrong writes).
- Which existing endpoint/mutation performs the write.
- The confirmation summary template.
- Whether the operation is a create or an upsert (upserting "today's entry" by a natural
  key like `(userId, date[, slot])` is usually right for daily-log style data — it makes
  "log it" and "update it" the same code path, and the interpreter doesn't need to
  distinguish create vs. update at all).

---

## Security & guardrails checklist

- [ ] Every voice/text-command endpoint requires authentication — no anonymous access,
      even for the "just classify intent" endpoint (it still costs money/compute and can be
      abused as a free-form LLM proxy otherwise).
- [ ] Rate limit the interpret endpoint and the write endpoints (they may already have
      limits from the normal UI path — reuse those, don't add a separate looser limit for
      "voice" traffic).
- [ ] Streaming socket: one concurrent session per user, idle + max-duration timeouts,
      per-user connection-rate limit.
- [ ] Transcript length capped server-side before it reaches the interpreter.
- [ ] TTS input length capped server-side (it may receive model-generated text).
- [ ] Confirmation is mandatory for every write intent by default; only relax per-intent,
      deliberately, never globally.
- [ ] The execution layer never accepts a client-supplied "owner"/"user" field for a write
      — always resolved from the authenticated session server-side.
- [ ] `operationId` idempotency on every write call.
- [ ] Report/suggestion output passes the Layer 5 validator before being shown or spoken —
      no exceptions, even for the "just testing" path.
- [ ] Secrets/API keys for the STT/TTS/LLM providers are server-side only — the client never
      holds a provider key directly, only your own app's auth token.

---

## Suggested module layout (adapt names/paths to your stack)

```
<server>/
  routes/
    voice.ts              # POST /transcribe, GET+POST /speak, POST /translate (role-agnostic, requireAuth only)
    voiceStream.ts         # WS proxy, attached to the same HTTP server
    <domain>.ts             # existing CRUD routes — reused as-is by the execution layer
    <domain>/voice-interpret.ts  # POST /voice/interpret — the one endpoint that calls the interpreter
  services/
    intentInterpreter.ts   # interface + Real/Mock implementations + adapter resolver
    reportAggregation.ts   # deterministic fact-computation (Layer 5 Step 1)
    reportHumanizer.ts     # optional LLM rephrase + validator (Layer 5 Steps 4-5)

<client>/
  lib/
    voiceSession.ts        # mic capture, streaming/batch STT client, TTS playback, conversation loop
    voiceTranslation.ts    # optional
    voiceLanguage.ts        # optional, persisted language preference
  components/
    AskAgent*.tsx           # UI: mic button, transcript log, confirmation card
  hooks/
    useVoiceConversation.ts # Layer 3 state machine — interpret → confirm → execute → speak
```

---

## API contract sketch

```
POST /api/voice/transcribe          multipart audio  -> { transcript }
GET|POST /api/voice/speak           { text }         -> audio bytes
POST /api/voice/translate           { text, sourceLanguage, targetLanguage, mode } -> { text }
WS   /api/voice/stream?token=...    binary PCM in <-> { type: interim|final|utterance_end|error } out

POST /api/<domain>/voice/interpret
  body: { transcript: string, pendingIntent?: {...} }
  -> { intent, fields, missingFields, followUpQuestion?, requiresConfirmation, spokenResponse }

# Everything else the agent triggers is just your EXISTING endpoints, called by the
# client's execution layer after confirmation — no new write surface.
```

---

## Testing plan

- **Interpreter (mock)**: table-test transcripts → expected `{ intent, fields, missingFields }`
  for every supported intent, plus a few "should be unsupported" negative cases.
- **Interpreter (real)**: a small integration suite gated behind the provider API key being
  present in CI secrets (skip otherwise) — assert schema conformance and a few golden cases.
- **Confirmation state machine**: unit test `handleTranscript` transitions — missing-field
  loop terminates and asks the right follow-up; affirmative/negative parsing; cancel clears
  state; a fresh unrelated command while a confirmation is pending is handled sanely (your
  choice: treat as answer to the pending question, or drop pending and treat as new command
  — pick one and test it).
- **Idempotency**: same `operationId` submitted twice → second call returns `changed: false`
  and does not double-write.
- **Report validator**: unit test the Step 5 validator directly with adversarial candidate
  strings (raw digits outside tokens, unknown metric names, causal language, unresolved
  tokens, missing tokens entirely) — every one must be rejected.
- **E2E** (optional but valuable): drive the full loop with a mocked speech-recognition
  input against a real server instance, across every role/persona your app has, covering at
  least one full example of redirect, add/update with confirmation, and a report question.

---

## Acceptance criteria

- [ ] A user can say/type a navigation command and land on the right screen without any
      confirmation step.
- [ ] A user can say/type a create/update command; the app asks a natural follow-up for any
      missing required field; once complete, it asks for confirmation with a plain-language
      summary; only on "yes" does the write actually happen, through the app's normal
      endpoint.
- [ ] Saying "no"/"cancel" at the confirmation step performs no write and says so.
- [ ] A user can ask a status/report question and get an answer built entirely from real
      data — verified by checking that every number in the spoken/displayed answer traces
      back to a value your aggregation code computed, not free text from the model.
- [ ] Killing/misconfiguring the LLM provider (no API key) does not break the app — the
      mock interpreter and the deterministic report fallback both keep the core flows
      working, just without natural-language polish.
- [ ] Retrying the same write twice (e.g. flaky network) does not create a duplicate record.

---

## Non-goals (don't build these unless asked)

- A general-purpose chatbot / open-ended assistant beyond the three defined capabilities.
- The NLU layer directly querying or writing the database "for convenience."
- Auto-confirming writes by default.
- Letting the report/suggestion layer answer questions about data outside the
  authenticated user's own scope.
