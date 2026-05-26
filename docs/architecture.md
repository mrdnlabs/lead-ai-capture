# Architecture

See the approved plan at `C:/Users/dnich/.claude/plans/hey-maybe-you-can-iterative-wreath.md` for the full version. This page is the in-repo summary kept in sync with the plan.

## Layers

- **Client (PWA)** — Next.js 16 App Router, served as installable PWA via `@serwist/next`. Dexie 4 owns the offline outbox. Two parallel media subsystems share one mic stream per capture session:
  - `MediaRecorder` — always-on, writes the full recording to a local `Blob`.
  - WebRTC/WebSocket to the realtime provider (OpenAI Realtime or Gemini Live) — only when online + AI assist toggled on. AI TTS audio is mixed back into the MediaRecorder source via `MediaStreamAudioDestinationNode` so the local file captures the full conversation.
- **Edge (Next.js middleware)** — Supabase session refresh, show-scoping (`/s/[showCode]/...`).
- **Functions (Vercel Fluid Compute, Node 24)** — REST endpoints for upload, signed URLs, ephemeral token mint, reconciliation, CSV export.
- **Workflow DevKit** — durable pipeline `processCapture` triggered by upload completion.
- **Data** — Supabase Postgres (Drizzle) for structured records; Supabase Storage (private buckets) for audio + photos; Vercel Runtime Cache for hot lead views.
- **AI plane** — Vercel AI Gateway for text-only calls (Claude vision + extraction); direct provider connections (with server-minted ephemeral tokens) for OpenAI Realtime / Gemini Live; server-side calls for batch transcription providers.

## Data flow

### Online (realtime assist)
1. Capture page requests mic + camera permissions
2. Photo snapped → MediaRecorder starts
3. POST `/api/realtime/token` → server resolves active provider + decrypts credential → mints ephemeral token → returns `{ token, transport, endpoint, model }`
4. Client opens WebRTC (OpenAI) or WebSocket (Gemini) directly with the ephemeral token
5. Conversation streams; AI asks gap-filling questions
6. Rep taps "Done" → MediaRecorder stops → photo + audio + metadata POST to `/api/captures`
7. Workflow `processCapture` runs server-side (transcribe → extract → merge into lead)

### Offline
1. Capture page records photo + audio
2. Dexie row written: `{ id, opportunityCode, photoBlob, audioBlob, capturedAt, repId, showId, status: 'queued' }`
3. Service worker registers `sync.register('capture-upload')` on Android
4. On reconnect (or app focus on iOS), queue drains via the same `/api/captures` endpoint
5. Same Workflow runs — rep sees no difference

## Diagram (textual)

```
phone (PWA)
 ├── MediaRecorder ─────────────────┐
 ├── WebRTC/WSS to OpenAI/Gemini ───┤ (online only)
 ├── Dexie outbox ──────────────────┤ (offline)
 └── HTTPS ──> Next.js Fluid Compute
                ├── /api/captures ──> Supabase Storage upload
                │                      └─> Postgres `captures` row
                │                          └─> Workflow processCapture
                │                                ├── normalizeAudio (Sandbox)
                │                                ├── transcribe (Deepgram/Gemini/OpenAI/Google)
                │                                ├── extractBadge (Claude Opus 4.7 vision)
                │                                ├── extractTranscript (Claude Sonnet 4.6)
                │                                ├── mergeIntoLead (Postgres txn)
                │                                └── invalidateCache
                ├── /api/realtime/token ──> mint ephemeral token, return to client
                ├── /api/shows/[id]/export.csv ──> stream CSV
                └── /admin/* ──> credentials, configs, analytics
```
