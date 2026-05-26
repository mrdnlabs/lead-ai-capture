# Realtime Design

Two pluggable providers, one client hook, one mic stream.

## Server-side token mint (`app/api/realtime/token/route.ts`)

Supabase-Auth-gated POST with `{ opportunityId }`:
1. Resolve the show's active `realtime_provider_config_id` (or A/B-roll one)
2. Decrypt the credential via `lib/crypto/keyVault.ts`
3. Build `instructions` server-side from `buildAgentContext(opportunityId)` — the AI's system prompt seeded with current known fields and missing fields
4. Call the provider's `mintEphemeralToken(...)` adapter
5. Return `{ token, transport, endpoint, model, providerConfigId, expiresAt }` to the client

## OpenAI Realtime (`gpt-realtime`)

- Transport: WebRTC
- Endpoint: `https://api.openai.com/v1/realtime/calls`
- Ephemeral token: `ek_*` format, 60 s TTL (configurable)
- Client: standard `RTCPeerConnection`, mic track + audio track exchange
- Transcript events: `conversation.item.input_audio_transcription.completed`

## Gemini Live (`gemini-3.1-flash-live`)

- Transport: WebSocket
- Endpoint: `wss://generativelanguage.googleapis.com/.../BidiGenerateContent`
- Ephemeral token: `auth_tokens:create`
- Client: `WebSocket`, send `setup` with `system_instruction`, stream 16 kHz PCM mic chunks via `realtimeInput`, receive 24 kHz PCM audio chunks
- Transcript events: `inputTranscription` / `outputTranscription`
- Session cap: 15 minutes (audio-only)

## Client hook (`lib/realtime/useRealtimeAssist.ts`)

Provider-agnostic React hook that branches on `transport`. Both branches:
- Clone the mic track for use by MediaRecorder + the realtime connection
- Pipe incoming AI audio to `<audio>` AND mix into the MediaRecorder source via `MediaStreamAudioDestinationNode`
- Push transcript events into the `captures.realtimeTranscript` jsonb column on upload

## Security

The client **never** sees the long-lived provider API key. Only the ephemeral token, which:
- Has a short TTL (60s to 30min depending on provider)
- Is scoped to a single session with pre-baked `instructions`, `max_duration`, `voice`
- Cannot override the model (server-chosen)

The token endpoint is rate-limited per rep (10 mints/min) to bound damage if a session cookie leaks.
