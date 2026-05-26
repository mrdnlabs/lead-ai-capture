# Processing Pipeline

Implemented as a Vercel Workflow DevKit workflow at `workflows/processCapture.ts`. Each step is idempotent on `captureId`.

## Steps

1. **fetchBlobs** — read audio + photo from Supabase Storage via signed URLs
2. **normalizeAudio** — ffmpeg → 16 kHz mono WAV. Likely runs in a Vercel Sandbox to avoid bundling `ffmpeg.wasm` (~25 MB) into every function
3. **transcribe** — resolve the show's active `TranscriptionProvider` (or A/B-roll). If `hadRealtimeAssist`, the realtime provider's transcript is preferred and this step runs in shadow mode for benchmarking. In A/B mode, BOTH selected providers run; results stored as separate `capture_extractions` rows
4. **extractBadge** — Claude Opus 4.7 vision, `generateObject` against a Zod schema derived at runtime from the show's `custom_field_definitions`
5. **extractTranscript** — Claude Sonnet 4.6, `generateObject` against the same schema
6. **mergeIntoLead** — DB transaction: upsert `leads`, merge per precedence rules, recompute `missingFields`
7. **invalidateCache** — `updateTag('lead:${opportunityId}')`, `updateTag('show:${showId}:leads')`
8. **markProcessed** — set `captures.status='processed'`

## Lead merge precedence

When multiple captures share an opportunity, fields are merged with the following priority order, ties broken by `confidenceScore` then `clientCapturedAt`:

1. Badge OCR (Claude vision on the photo)
2. Realtime-assisted transcript (rep + AI conversation)
3. Offline transcript (rep only)

## Idempotency

- `captures.idempotency_key` is uniquely indexed; client uses UUIDv7.
- `leads.processed_capture_ids` is a uuid[] of every capture already merged in; the merge step is a no-op if the capture ID is already present.
- Every workflow step is keyed by `(captureId, stepName)` in Workflow DevKit, so retries don't double-execute downstream effects.

## Cost + latency instrumentation

Each step records `latencyMs` and `costEstimateUsd` into `capture_extractions`. The admin analytics page surfaces these for OpenAI vs Gemini comparison.
