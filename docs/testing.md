# Testing

## Layers

- **Vitest** unit tests — co-located as `*.test.ts` next to source. Examples: `lib/crypto/keyVault.test.ts`. Run with `pnpm test`.
- **Playwright** end-to-end tests — `tests/e2e/`. Run with `pnpm test:e2e`.

## Fixtures (`tests/fixtures/`)

- `badges/` — 6 sample badge photos (varied lighting, orientations; synthetic if needed)
- `audio/` — 6 WAV/webm clips: clean intro, noisy booth, hybrid (offline-then-realtime), silent, very long, accented English
- `csv/` — 2 sample iCapture export headers
- `seed.ts` — creates shows, reps, opportunities, lead_forms in the DB

## Playwright media fixtures

`tests/e2e/fixtures/media.ts` launches Chromium with:

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=<wav path>
--use-file-for-fake-video-capture=<y4m path>
```

The wav/y4m path is swapped per test via context options. This lets the AI agent run capture flows end-to-end without a real mic or camera.

## Mocking AI providers

`tests/e2e/mocks/aiGateway.ts` — Playwright route interceptor for `https://gateway.ai.vercel.com/*` returning canned JSON keyed by request hash. Recorded once with `PLAYWRIGHT_RECORD=1` against real models, then replayed in CI.

`tests/e2e/mocks/openaiRealtime.ts` and `mocks/geminiLive.ts` — intercept the WebRTC offer / WebSocket connect. Realtime suites are disabled by default; `@realtime` tagged suite hits live APIs behind a flag.

## Spec inventory (planned)

- `capture.spec.ts` — basic online capture flow
- `offline.spec.ts` — `context.setOffline(true)`, capture, assert Dexie row, go online, assert upload + lead row
- `multiphone.spec.ts` — two browser contexts, same opportunity code, both capture, assert single merged lead
- `extraction.spec.ts` — fixture audio + badge → assert exact `mergedFields`
- `realtime-openai.spec.ts` / `realtime-gemini.spec.ts` — token + connect paths against stubs
- `ab-transcription.spec.ts` — A/B mode produces two `capture_extractions` rows
- `admin-credentials.spec.ts` — encrypted at rest, last4 only in UI

## Adding a new E2E test

1. Pick a representative fixture from `tests/fixtures/`, or create one
2. If new AI provider behavior needed, run `PLAYWRIGHT_RECORD=1 pnpm test:e2e <spec>` to capture real responses
3. Replay deterministically in CI with no env var
4. Assert on user-visible state (DOM) + DB state (`db.select(...).where(...)` from the test)
