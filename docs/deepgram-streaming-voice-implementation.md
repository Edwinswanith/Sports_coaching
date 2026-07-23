# Implementation Prompt: Deepgram Streaming WebSocket + Endpointing

Use this document as the full task brief for an agent or developer implementing live streaming speech-to-text for the Sports Coaching Platform mobile Ask Agent.

---

## Copy-paste prompt (start here)

```
Implement Deepgram streaming WebSocket STT with endpointing for the mobile Ask Agent voice conversation, replacing the current batch record-and-upload flow.

## Context

Monorepo: npm workspaces (`mobile`, `server`). Mobile authenticates with Bearer JWT via expo-secure-store (`mobile/src/lib/api.ts`). Server is Express on port 4000.

### Current voice stack (slow — replace STT only)

| Layer | File | Behavior today |
|-------|------|----------------|
| Conversation loop | `mobile/src/lib/voiceSession.ts` → `startVoiceConversation()` | listen → execute command → TTS → listen again |
| STT (batch) | `mobile/src/lib/voiceSession.ts` → `startDeepgramVoiceSession()` | Records up to 9s, uploads full file to `POST /api/voice/transcribe`, waits for transcript |
| TTS | `mobile/src/lib/agentSpeech.ts` | Deepgram via `GET /api/voice/speak` with Expo Speech fallback — keep as-is |
| NLU | `POST /api/athlete/voice/interpret` | Gemini intent classification — keep as-is |
| Server STT proxy | `server/src/routes/voice.ts` | Prerecorded Deepgram `/v1/listen` — keep for fallback, add streaming alongside |

### Problem

Batch STT waits up to 9 seconds before transcribing. Manual stop skips transcription (`finish(false)`). This makes voice conversation feel dead. Target: final transcript within ~300–800ms after the user stops speaking.

### Goal

Replace batch STT with **Deepgram Live Streaming** over WebSocket, using **endpointing** to detect end-of-utterance. Keep the existing `VoiceSessionHandlers` / `VoiceConversationHandlers` public API unchanged so callers (`AskAgentControl`, athlete dashboard) need no changes.

---

## Architecture (required)

```
Mobile mic (PCM chunks)
    ↕ WebSocket (binary audio up, JSON events down)
Server proxy  wss://<api>/api/voice/stream
    ↕ WebSocket
Deepgram Live  wss://api.deepgram.com/v1/listen?...
```

**Do NOT expose `DEEP_GRAM` / `DEEPGRAM_API_KEY` to the mobile client.** The server holds the key and proxies the stream.

### Why server proxy (not direct mobile → Deepgram)

- JWT auth already exists (`server/src/middleware/auth.ts` accepts Bearer header)
- API key stays server-side
- Rate limiting can reuse existing patterns
- Cloud Run / CORS stays consistent with current `/api/voice/*` routes

---

## Server implementation

### 1. Add WebSocket support to Express

- Add dependency: `ws` (and `@types/ws` dev)
- In `server/src/index.ts`, create an HTTP server from the Express app and attach a WebSocket server on path `/api/voice/stream`
- Mount after existing routes; do not break REST `/api/voice/transcribe` or `/api/voice/speak`

### 2. New module: `server/src/routes/voiceStream.ts` (or `server/src/services/voiceStreamProxy.ts`)

Responsibilities:

1. **Authenticate** the WebSocket upgrade:
   - Read `Authorization: Bearer <token>` from the upgrade request headers, OR
   - Accept `?token=<accessToken>` query param for React Native WebSocket (which cannot set custom headers on all platforms — prefer query param with short-lived validation, or document header support for web)
   - Reuse the same JWT verification logic as `requireAuth` (verify access token, reject expired/invalid with close code 4401)

2. **Open upstream Deepgram live socket** on client connect:
   ```
   wss://api.deepgram.com/v1/listen?
     model=<env.deepgram.sttModel>          // default nova-3
     &encoding=linear16
     &sample_rate=16000
     &channels=1
     &interim_results=true
     &endpointing=400
     &utterance_end_ms=1000
     &vad_events=true
     &smart_format=true
   ```
   Headers: `Authorization: Token ${env.deepgram.apiKey}`

3. **Proxy messages**:
   - Client → Server (binary): forward raw PCM audio frames to Deepgram
   - Client → Server (JSON control): optional `{ "type": "CloseStream" }` to finalize
   - Deepgram → Server → Client (JSON): forward transcript events

4. **Normalize outbound events** to a small client contract:
   ```ts
   type VoiceStreamServerMessage =
     | { type: "interim"; transcript: string }
     | { type: "final"; transcript: string }
     | { type: "utterance_end"; transcript: string }
     | { type: "error"; code: string; message: string };
   ```

5. **Session hygiene**:
   - One Deepgram socket per client WebSocket
   - On client disconnect: send Deepgram `CloseStream`, close both sockets
   - On Deepgram error: forward error JSON, close client socket
   - Idle timeout: close after 30s with no audio (configurable)
   - Rate limit: max 1 concurrent stream per userId (in-memory map is fine for v1)

6. **Deepgram not configured**: close with `{ type: "error", code: "deepgram_not_configured" }`

### 3. Env (already in `server/src/config/env.ts`)

```env
DEEP_GRAM=...                          # or DEEPGRAM_API_KEY
DEEPGRAM_STT_MODEL=nova-3              # optional, existing default
DEEPGRAM_STREAM_ENDPOINTING_MS=400     # new optional
DEEPGRAM_STREAM_UTTERANCE_END_MS=1000  # new optional
```

Update `.env.example` with the new optional vars (no secrets).

### 4. Keep batch route as fallback

Do not delete `POST /api/voice/transcribe`. Mobile may fall back if WebSocket fails.

---

## Mobile implementation

### 1. Replace `startDeepgramVoiceSession()` in `mobile/src/lib/voiceSession.ts`

Implement `startDeepgramStreamingVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle` and make `startVoiceSession()` call it instead of the batch recorder.

**Requirements:**

- Preserve the exact `VoiceSessionHandlers` callback contract:
  - `onListeningChange(true)` when mic stream starts
  - `onVolume(level)` with real RMS from audio chunks (not fake pulse animation)
  - `onResult(transcript)` once per utterance on **final** transcript (from `is_final: true` or `UtteranceEnd` event)
  - `onError()` on failure
  - `onNeedsFallback()` on permission denied or unsupported platform
  - `stop()` cancels mic, closes WebSocket, does NOT call `onResult`

- **WebSocket URL**: derive from `API_BASE` in `mobile/src/lib/api.ts`:
  - `http://` → `ws://`, `https://` → `wss://`
  - Path: `/api/voice/stream?token=${encodeURIComponent(accessToken)}`
  - Use `getAccessToken()` from api.ts

- **Audio capture** (hardest part — pick one approach and document tradeoffs in PR):
  - **Preferred if feasible**: stream 16kHz mono linear16 PCM in ~100–250ms chunks while recording
  - Investigate `expo-audio` / `AudioModule` for live PCM access; if unavailable, use `expo-av` Audio.Recording with a platform-specific chunk strategy OR a small native module
  - **Fallback v1**: use `@deepgram/sdk` live client only on web with MediaRecorder/AudioWorklet; on native, fall back to batch `/transcribe` until PCM streaming works — but document this clearly
  - Target: Android + iOS native must work for production; web/PWA is secondary

- **Endpointing behavior**:
  - Do NOT use a fixed 9s timer
  - Fire `onResult` when server sends `{ type: "final", transcript }` or `{ type: "utterance_end", transcript }` with non-empty trimmed text
  - Debounce: ignore duplicate finals for the same utterance
  - Optional: expose interim text via new optional handler later — not required for v1

- **Max listen window**: keep 10s conversation timeout in `startVoiceConversation()` (existing `silenceTimeoutMs`) — that is separate from endpointing

- **Manual stop** (user taps FAB to end conversation): `stop()` closes stream cleanly; do not transcribe partial audio unless Deepgram already sent a final

### 2. Do NOT change

- `startVoiceConversation()` turn loop (listen → onResult → speakAgentReply → listen)
- `mobile/src/lib/agentSpeech.ts` (Deepgram TTS)
- `AskAgentControl.tsx`, `RoleAskAgentOverlays.tsx`, athlete dashboard ask handlers
- Gemini `/api/athlete/voice/interpret`

### 3. Error handling / fallback chain

```
1. Try streaming WebSocket STT
2. On connect/auth/deepgram_not_configured failure → fall back to batch POST /api/voice/transcribe (existing code, extract to shared helper)
3. On batch failure → onNeedsFallback() → text input overlay (existing UX)
```

Log fallback reason in dev only (`__DEV__`).

---

## Deepgram event handling reference

Listen for Deepgram live JSON messages like:

```json
{
  "type": "Results",
  "channel": {
    "alternatives": [{ "transcript": "open water", "confidence": 0.98 }]
  },
  "is_final": true,
  "speech_final": true
}
```

Also handle:

- `type: "UtteranceEnd"` — user stopped speaking (endpointing fired)
- `type: "SpeechStarted"` — optional, for UI
- `type: "Error"` — forward and close

Send to Deepgram when done:

```json
{ "type": "CloseStream" }
```

---

## Security checklist

- [ ] Deepgram API key never in mobile bundle or `EXPO_PUBLIC_*`
- [ ] WebSocket requires valid JWT (same as REST)
- [ ] Reject unauthenticated upgrades before opening Deepgram socket
- [ ] Rate limit stream connections (e.g. 30/min per user, align with existing voice rate limits)
- [ ] Max session duration 30s
- [ ] No audio persisted to disk on server (stream-through only)

---

## Testing

### Server unit/integration tests (`server/tests/voice-stream.test.ts`)

- Mock Deepgram WebSocket with a fake server or stub `ws` client
- Auth: reject missing token, accept valid JWT, reject expired
- Proxy: binary audio forwarded, final transcript JSON returned to client
- deepgram_not_configured returns error event

### Manual test plan

1. Start stack: `npm run dev:server` + `npm run dev:mobile`
2. Set `DEEP_GRAM` in `server/.env`
3. Log in as athlete, open dashboard, tap Ask Agent
4. Say "open water" — expect transcript + navigation in **< 3s total** (not 9s)
5. Say "add 250 ml water" — expect fast STT; Gemini interpret may add ~1s
6. Tap stop mid-utterance — conversation ends cleanly, no duplicate commands
7. Multi-turn: ask two commands back-to-back without re-tapping FAB
8. Kill `DEEP_GRAM` — verify fallback to batch or text input, no crash

### Typecheck

```bash
npm run typecheck
```

---

## Performance targets (acceptance criteria)

| Metric | Target |
|--------|--------|
| Time from end of speech to final transcript | ≤ 800ms (good network) |
| No fixed 9s recording timer | Required |
| `VoiceSessionHandlers` API unchanged | Required |
| Batch `/transcribe` still works | Required |
| TTS unchanged | Required |
| Works on Android native | Required |
| JWT auth on WebSocket | Required |

---

## Files likely touched

| File | Change |
|------|--------|
| `server/src/index.ts` | HTTP server + WebSocket attach |
| `server/src/routes/voiceStream.ts` | New proxy |
| `server/src/config/env.ts` | Optional streaming tuning env vars |
| `server/package.json` | Add `ws` |
| `mobile/src/lib/voiceSession.ts` | Streaming STT replaces batch |
| `.env.example` | Document new env vars |
| `server/tests/voice-stream.test.ts` | New tests |

Optional later (out of scope for v1):

- Show interim transcript in Ask Agent UI
- `GEMINI_MODEL=gemini-2.5-flash-lite` for faster NLU (separate change)

---

## Implementation constraints (monorepo rules)

- Coach scope invariant unchanged — streaming is client STT only, no new write paths
- No new admin role
- Minimize diff — do not refactor unrelated voice code
- Match existing TypeScript style, no over-abstraction
- Files should stay under ~300 lines; split helpers if needed
- Do not commit secrets (`.env`, API keys)

---

## Suggested implementation order

1. Server WebSocket proxy + manual test with `wscat` / small Node test client sending PCM
2. Mobile WebSocket client with hardcoded test PCM or web-only audio first
3. Wire real mic PCM streaming on Android
4. iOS parity
5. Fallback chain + tests
6. Remove 9s timer and fake pulse animation from batch path (keep batch as fallback only)

---

## PR description template

```
Replace batch Deepgram STT (9s record → upload) with live WebSocket streaming + endpointing.

- Add authenticated server proxy at wss://.../api/voice/stream
- Mobile streams PCM chunks; final transcript on Deepgram endpointing (~400ms silence)
- Batch /api/voice/transcribe retained as fallback
- No changes to TTS, NLU, or Ask Agent UI handlers

Tested: Android device, athlete dashboard voice commands, multi-turn conversation.
```
```

---

## Quick reference: current code locations

```
mobile/src/lib/voiceSession.ts     # Replace startDeepgramVoiceSession (batch)
mobile/src/lib/agentSpeech.ts      # TTS — do not change
mobile/src/lib/api.ts              # API_BASE, getAccessToken()
mobile/src/components/AskAgentControl.tsx
server/src/routes/voice.ts              # Batch STT + TTS REST
server/src/config/env.ts                # deepgram.* config
server/src/middleware/auth.ts           # JWT verification to reuse
```

---

## Notes for the implementing agent

- Read Expo SDK 56 docs before choosing mic streaming APIs: https://docs.expo.dev/versions/v56.0.0/
- If `expo-audio` cannot stream PCM in v56, state the limitation explicitly and implement the best available path rather than blocking the whole feature
- Endpointing at 400ms is a starting point; tune `endpointing` and `utterance_end_ms` if commands get cut off mid-sentence
- The conversation wrapper already calls `current?.stop()` after `onResult` — streaming session `stop()` must be idempotent and fast
