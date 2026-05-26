# Provider Abstraction

Both realtime voice and batch transcription are pluggable behind common interfaces so providers can be swapped or A/B tested without changing application code.

## Realtime providers (`lib/providers/realtime/`)

```ts
interface RealtimeProvider {
  kind: 'realtime';
  mintEphemeralToken(args: {
    instructions: string;
    voice?: string;
    maxDurationSec?: number;
    credentials: DecryptedCredentials;
  }): Promise<{ token: string; expiresAt: number; transport: 'webrtc' | 'websocket'; endpoint: string; model: string }>;
}
```

Implementations:
- `openai.ts` — `gpt-realtime` GA via WebRTC
- `gemini.ts` — `gemini-3.1-flash-live` preview via WebSocket

## Transcription providers (`lib/providers/transcription/`)

```ts
interface TranscriptionProvider {
  kind: 'transcription';
  transcribe(args: {
    audioBlobKey: string;
    language?: string;
    credentials: DecryptedCredentials;
  }): Promise<{
    transcript: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    confidence?: number;
    costEstimateUsd: number;
    latencyMs: number;
  }>;
}
```

Implementations:
- `openai-gpt4o-transcribe.ts` — `gpt-4o-transcribe`
- `openai-whisper.ts` — `whisper-1` (batch fallback)
- `gemini-audio.ts` — `gemini-2.5-flash` or `gemini-3.1-flash` audio understanding
- `google-stt-chirp3.ts` — Google Cloud Speech-to-Text v2 Chirp 3
- `deepgram-nova3.ts` — Deepgram Nova-3

## A/B testing

`provider_ab_assignments` rows let an admin run two providers head-to-head on the same show. The Workflow `transcribe` step, when it sees an A/B assignment, runs BOTH providers and writes two `capture_extractions` rows. Analytics shows side-by-side cost, latency, and transcript diffs; admins can pick a "gold" transcript per capture to compute Word Error Rate.

## Adding a new provider

1. Create `lib/providers/<kind>/<name>.ts` implementing the interface
2. Add the provider value to the `provider_kind` enum (and run a migration)
3. Register it in `lib/providers/<kind>/index.ts` (provider registry)
4. Add a stubbed mock under `tests/e2e/mocks/`
5. Document any provider-specific quirks here
