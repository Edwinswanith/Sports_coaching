# Implementation Prompt: Voice Conversation Improvements

Use this document as the full task brief for an agent or developer improving the Sports Coaching Platform **Ask Agent** voice conversation (latency, accuracy, consistency, and UX).

Related doc: [deepgram-streaming-voice-implementation.md](./deepgram-streaming-voice-implementation.md) (STT streaming — largely done; this doc covers the rest).

---

## Copy-paste prompt (start here)

Improve the mobile Ask Agent voice conversation so it feels fast, consistent, and reliable across athlete/coach/guardian roles. Focus on perceived latency, NLU accuracy, and unified UX — not new features outside existing voice capabilities.

## Context

Monorepo: npm workspaces (`mobile`, `server`). Mobile auth: Bearer JWT via expo-secure-store.

### Current voice stack

| Layer | File | Behavior today |
|-------|------|----------------|
| Conversation loop | `mobile/src/lib/voiceSession.ts` → `startVoiceConversation()` | listen → execute → **await full TTS** → listen again (blocking) |
| STT (native) | `voiceSession.ts` → `startDeepgramStreamingVoiceSession()` | 16 kHz PCM → `wss://.../api/voice/stream` → Deepgram (batch fallback on failure) |
| STT (web) | `voiceSession.ts` → `startWebSpeechVoiceSession()` | Browser SpeechRecognition (different from native) |
| TTS | `mobile/src/lib/agentSpeech.ts` | Deepgram `/api/voice/speak` with `downloadFirst: true` on native; Expo Speech on web |
| Server STT proxy | `server/src/routes/voiceStream.ts` | WebSocket proxy; supports nova-3 and flux models |
| NLU | `POST /api/athlete/voice/interpret` | Gemini (or mock) — **athlete role only** |
| Athlete dashboard | `mobile/src/app/athlete/dashboard.tsx` | Full agent: local regex fast-path → Gemini → API writes |

### Known problems (fix these)

1. **Blocking TTS** — `startVoiceConversation` awaits `speakAgentReply()` before re-opening mic; adds 1–3s per turn.
2. **Intro speech delay** — `"I'm listening."` + 350ms pause before first listen.
3. **No `pendingIntent` on mobile Gemini calls** — athlete dashboard sends `{ transcript }` only → worse multi-turn slot filling.
4. **Two athlete agents** — dashboard has full Gemini agent; sub-screens use weak regex overlay.
5. **Coach dead code** — `coach/dashboard.tsx` has `handleAskAgent` + report sheet but no wired FAB (live agent is layout overlay).
6. **Guardian not global** — no Ask Agent FAB outside dashboard.
7. **English-only STT/NLU** — no `language` param to Deepgram; Gemini prompt assumes English.
8. **Slow report queries** — `buildReportInfoResult` fires 7+ parallel `/api/athlete/daily` calls.
9. **Batch STT fallback** — still uses 9s record timer if streaming fails.
10. **No voice stream tests** — only `server/tests/athlete-voice.test.ts` for `/voice/interpret`.
11. **Generic errors** — users can't tell mic vs network vs Deepgram vs interpret failures apart.

### Goal

After this work, a voice turn on athlete dashboard should feel **≤ 3–5s total** on good network (STT + NLU + write + optional short TTS), with **instant on-screen feedback** even when TTS is still playing. Coach/guardian should have **consistent global FAB** behavior. No new DB collections or admin role.

---

## Phase 1 — Latency (highest impact, do first)

### 1.1 Non-blocking TTS + instant UI feedback

**File:** `mobile/src/lib/voiceSession.ts`

Change `startVoiceConversation` so that after `handlers.onResult(transcript)` resolves:
- Callers update conversation log / UI **immediately** when they have the reply text (already partially done via `askLastReplyRef` on dashboard).
- Do **not** block `listen()` on full TTS completion for short replies.

Options (pick one, document choice in PR):
- **A (recommended):** Add optional `speakReplies?: boolean` (default true). When false, skip TTS entirely; UI-only feedback.
- **B:** Fire `speakAgentReply()` without awaiting in the conversation loop; re-open mic after a short debounce (300ms) while TTS plays in background. Allow barge-in via existing stop FAB.
- **C:** Skip TTS for acks matching `/^(opening|logged|saved|cancelled|done)\b/i` or under 40 chars; speak longer replies only.

**File:** `mobile/src/components/AskAgentControl.tsx` — same pattern if it duplicates the loop.

**Acceptance:** Say "open water" → section opens and log updates in **< 1s after STT**; mic can reopen before TTS finishes.

### 1.2 Remove intro speech (or make opt-in)

**Files:** `athlete/dashboard.tsx`, `AskAgentControl.tsx`, any caller passing `introPrompt: "I'm listening."`

- Remove `introPrompt` default or set to empty string.
- Keep visual status pill ("Listening") only.
- Remove the 350ms post-intro delay in `startVoiceConversation` when intro is empty.

### 1.3 Gemini Flash Lite + pendingIntent

**Server:** `server/.env.example` — document `GEMINI_MODEL=gemini-2.5-flash-lite`.

**Mobile athlete dashboard:** When calling `/api/athlete/voice/interpret`, send full pending intent:

```ts
body: JSON.stringify({
  transcript,
  pendingIntent: askPendingGeminiRef.current ?? undefined,
})
```

Where `askPendingGeminiRef` holds `{ intent, collected, missingFields }`, not just `VoiceIntentName | null`.

### 1.4 Widen local fast-path (skip Gemini)

Before `/voice/interpret`, ensure these never hit Gemini:
- `open/show/go to` + section keywords
- Obvious water amount: `\d+\s*ml`
- Rest day set/clear
- Coach message / note extractors (already partially done)

Extract shared helpers to `mobile/src/lib/askAgentCommands.ts` if needed.

### 1.5 TTS latency

**File:** `mobile/src/lib/agentSpeech.ts`

- Evaluate removing `downloadFirst: true` or switching to streaming if expo-audio supports it.
- Keep Deepgram → Expo fallback chain.
- Shorten default spoken responses in command handlers ("Logged." vs "Logged 250 ml of water to today's hydration total.").

### 1.6 Batch fallback timer

**File:** `voiceSession.ts` → `startDeepgramVoiceSession`

- Reduce 9000ms timer to **2500–3000ms** max.
- On manual `stop()`, call `finish(true)` if recording had audio (not `finish(false)` which skips transcription).

---

## Phase 2 — Consistency (UX)

### 2.1 Unify athlete Ask Agent

**Problem:** `AthleteAskAgentOverlay` (regex) on `/athlete/water`, `/trends`, etc. vs full agent on dashboard.

**Pick one approach:**
- **A (recommended):** Extract dashboard ask logic to `mobile/src/lib/useAthleteAskAgent.ts` (or hook + provider). Use on dashboard; overlay on other screens delegates to same hook or navigates to dashboard with `?section=` + auto-open agent.
- **B:** Remove overlay entirely; FAB on athlete sub-screens deep-links to dashboard ask mode.

Do not maintain two divergent command handlers.

### 2.2 Coach dashboard cleanup

**File:** `mobile/src/app/coach/dashboard.tsx`

- Remove unused `handleAskAgent`, `askInputOpen`, `CoachAskReportSheet` if `CoachAskAgentOverlay` in layout is the sole entry point.
- Or wire dashboard to overlay ( worse — prefer delete dead code).

Verify e2e: `e2e/ask-agent-mobile.spec.ts` coach tests still pass.

### 2.3 Guardian global overlay

**Files:** `mobile/src/app/guardian/_layout.tsx`, new or moved handler from `guardian/dashboard.tsx`

- Add `GuardianAskAgentOverlay` (mirror coach pattern) or move existing `AskAgentControl` + handler to layout.
- FAB visible on guardian athlete detail and all guardian routes.

### 2.4 Show interim STT transcript (optional but high perceived speed)

**Files:** `voiceSession.ts`, athlete dashboard ask UI

Server already sends `{ type: "interim", transcript }`. Surface in status pill or conversation log while user speaks.

---

## Phase 3 — Accuracy

### 3.1 STT language parameter

**Files:** `server/src/routes/voiceStream.ts`, `server/src/routes/voice.ts`, `voiceSession.ts`

- Add `mobile/src/lib/voiceLanguage.ts` — persist `en-IN | ta | te` (AsyncStorage / SecureStore).
- Append `&language=` to WebSocket URL; pass to batch transcribe.
- Settings UI: simple language picker (profile or ask-agent long-press menu).

Do **not** use `language=multi` for Tamil/Telugu — use `ta`, `te`, `en-IN` per session. Malayalam not supported by Deepgram (document limitation).

### 3.2 Multilingual Gemini prompt

**File:** `server/src/services/voiceIntentInterpreter.ts`

Extend `SYSTEM_PROMPT` with:
- Transcript may be English, Tamil, Telugu, or Tanglish.
- Examples: "250 ml neeru", "நீர் சேர்", "open water" → same intents.
- Never invent numbers; same JSON schema.

Optional: accept `language` in interpret request body for context.

### 3.3 Deepgram keyterms (optional)

**File:** `voiceStream.ts`

When connecting to Deepgram, pass keyterms for: `RPE`, `readiness`, `AM`, `AFT`, `PM`, common sports terms. Use env `DEEPGRAM_KEYTERMS` comma-separated or hardcode small list.

### 3.4 Auto-confirm low-risk writes

Mirror web `autoConfirmWrites` for:
- `add_water` (when amount present)
- `navigate`
- `query_status`

Keep confirmation for: `send_coach_message`, `add_note`, rest day changes, wellness/training bulk writes.

---

## Phase 4 — Reliability and production

### 4.1 Environment

Ensure documented in `.env.example`:
```env
DEEP_GRAM=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
DEEPGRAM_STT_MODEL=flux-general-en
DEEPGRAM_TTS_MODEL=aura-2-harmonia-en
DEEPGRAM_STREAM_ENDPOINTING_MS=400
DEEPGRAM_STREAM_UTTERANCE_END_MS=1000
```

Optional Flux: handle `TurnInfo` / `EndOfTurn` events in `voiceStream.ts` when model starts with `flux-`.

### 4.2 Error mapping

Map errors to user-facing messages:
| Code / case | User message |
|-------------|--------------|
| `deepgram_not_configured` | "Voice isn't set up on the server. Use text instead." |
| `unauthenticated` | "Sign in again to use voice." |
| `empty_transcript` | "I didn't catch that. Try again." |
| `interpret_failed` | "I couldn't understand that command." |
| Mic permission denied | Existing fallback to text input |

### 4.3 Server tests

**New file:** `server/tests/voice-stream.test.ts`

- Reject unauthenticated WebSocket
- Mock upstream Deepgram; verify final/utterance_end forwarded
- `deepgram_not_configured` returns error JSON

Keep existing `athlete-voice.test.ts` green.

### 4.4 Report query performance

**File:** `athlete/dashboard.tsx` → `buildReportInfoResult`

- Prefer cached `card` / dashboard state when date range overlaps.
- Or add single server endpoint later — for this task, at minimum avoid refetching 7 days if data already in memory.

---

## Phase 5 — Architecture (if time permits)

Extract from `athlete/dashboard.tsx` (~7400 lines):
- `useAthleteAskAgent.ts` — command execution, voice hooks, conversation log
- Keep dashboard as UI composition only

Target: new module **< 400 lines**; dashboard shrinks meaningfully.

---

## Files likely touched

| File | Changes |
|------|---------|
| `mobile/src/lib/voiceSession.ts` | Non-blocking TTS, intro, batch timer, interim handler |
| `mobile/src/lib/agentSpeech.ts` | TTS latency |
| `mobile/src/lib/voiceLanguage.ts` | **New** — language preference |
| `mobile/src/lib/askAgentCommands.ts` | **New** — shared parsers (optional) |
| `mobile/src/lib/useAthleteAskAgent.ts` | **New** — extracted hook (optional) |
| `mobile/src/app/athlete/dashboard.tsx` | pendingIntent, intro, extract hook |
| `mobile/src/components/AskAgentControl.tsx` | Align with voiceSession changes |
| `mobile/src/components/RoleAskAgentOverlays.tsx` | Unify athlete; guardian overlay |
| `mobile/src/app/coach/dashboard.tsx` | Remove dead ask code |
| `mobile/src/app/guardian/_layout.tsx` | Global guardian FAB |
| `server/src/services/voiceIntentInterpreter.ts` | Multilingual prompt |
| `server/src/routes/voiceStream.ts` | language param, Flux events, keyterms |
| `server/src/routes/voice.ts` | language on batch transcribe |
| `server/src/config/env.ts` | Optional keyterms env |
| `.env.example` | Document voice env vars |
| `server/tests/voice-stream.test.ts` | **New** |
| `e2e/ask-agent-mobile.spec.ts` | Update if FAB locations change |

---

## Constraints (do not break)

- Coach scope invariant — NLU never writes to DB; client uses existing `/api/*` endpoints after confirm.
- No admin role. No new collections.
- `/api/athlete/voice/interpret` stays athlete-role gated unless explicitly adding coach read-only interpret (out of scope unless small).
- Minimize diff — no unrelated refactors.
- Do not commit secrets.
- Run before PR:
  ```bash
  npm run typecheck
  npm test --workspace server
  npm run lint --workspace mobile
  npm run test:e2e -- e2e/ask-agent-mobile.spec.ts
  ```

---

## Acceptance criteria

| Metric | Target |
|--------|--------|
| Time from end-of-speech to on-screen reply (simple nav) | ≤ 2s (good network) |
| Mic reopens before TTS ends (for short acks) | Yes |
| No spoken "I'm listening" on session start | Yes |
| Mobile sends `pendingIntent` on follow-up interpret calls | Yes |
| Athlete agent behavior consistent dashboard vs sub-screens | Yes |
| Guardian FAB on all guardian routes | Yes |
| Coach dashboard has no dead ask handler | Yes |
| Server tests pass including new voice-stream tests | Yes |
| Typecheck passes | Yes |

---

## Suggested implementation order

1. Phase 1.1 + 1.2 (non-blocking TTS, remove intro) — immediate feel improvement
2. Phase 1.3 + 1.4 (pendingIntent, fast-path)
3. Phase 2.1 + 2.2 + 2.3 (consistency)
4. Phase 4.2 + 4.3 (errors + tests)
5. Phase 3.1 + 3.2 (multilingual — if product requires)
6. Phase 5 (extract hook — tech debt)

---

## PR description template

```
Improve Ask Agent voice conversation latency and consistency.

- Non-blocking TTS with instant conversation log updates
- Remove intro speech delay; optional shorter acks
- Mobile pendingIntent parity with web for Gemini multi-turn
- Unify athlete ask agent; guardian global FAB; remove coach dead code
- Multilingual STT language param + Gemini prompt (if included)
- Voice stream server tests and clearer error messages

Tested: npm run typecheck, server tests, ask-agent-mobile e2e, manual voice on Android/web.
```
```

---

## Quick reference: web vs mobile gaps to close

| Feature | Web (`useVoiceConversation.ts`) | Mobile (today) |
|---------|----------------------------------|--------------|
| `pendingIntent` on interpret | Yes | **No** |
| `autoConfirmWrites` | Configurable | **No** |
| Local nav fast-path | Yes | Partial (dashboard only) |
| Non-blocking speak | Partial | **No** (blocks on TTS) |
| Global ask FAB | Sheet-based | Role overlays (inconsistent) |

Close these gaps first — web already solved several problems mobile has not ported.

---

## Out of scope (do not expand unless asked)

- CrewAI or multi-agent orchestration
- Malayalam STT (needs non-Deepgram provider)
- Tamil/Telugu TTS (Deepgram Aura English/Spanish only)
- Coach/guardian Gemini write intents (needs new API routes + RBAC design)
- Web mobile PWA Deepgram streaming (nice-to-have later)
