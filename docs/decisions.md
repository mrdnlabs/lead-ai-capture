# Architecture Decision Records (ADRs)

Append-only log. Newest at top. One entry per significant decision.

---

## ADR-005 — Use Supabase (Auth + Postgres + Storage) instead of Neon + Clerk + Vercel Blob

**Date**: 2026-05-26
**Status**: Accepted

**Context**: User already uses Supabase + Vercel at this company. Originally planned Neon + Clerk + Vercel Blob.

**Decision**: Full swap to Supabase. One provider, one billing line, one set of env vars.

**Consequences**: `reps.id` FKs to `auth.users(id)` instead of mirroring Clerk userIds. Drizzle still works against Supabase Postgres. Storage uses signed URLs instead of Vercel Blob's client tokens. Supabase Realtime available if we later need live multi-phone sync without adding Ably/Pusher.

---

## ADR-004 — Dual-provider abstraction for realtime + transcription (OpenAI + Gemini)

**Date**: 2026-05-26
**Status**: Accepted

**Context**: User wants to test both Gemini and OpenAI for realtime chat and transcription, ideally A/B.

**Decision**: Define `RealtimeProvider` and `TranscriptionProvider` interfaces; ship adapters for both providers from day one (Phase 2 + Phase 3). Add `provider_ab_assignments` table for head-to-head testing.

**Consequences**: Adapter layer adds ~200 LOC up front but avoids painful retrofitting. Admin can switch providers per show without code changes. Cost/latency/quality data accumulates from real use.

---

## ADR-003 — AES-256-GCM with env-based KEK (envelope-ish), not Vault/KMS

**Date**: 2026-05-26
**Status**: Accepted

**Context**: We need to encrypt provider API keys at rest. Options: AWS KMS, HashiCorp Vault, application-level AES.

**Decision**: AES-256-GCM with KEK in env var. KEK rotation via `ACTIVE_KEY_ENCRYPTION_KEY_ID` env var. Documented procedure in `runbook.md`.

**Consequences**: Simple, no external dependency, works on Vercel Fluid Compute out of the box. Tradeoff: KEK rotation is a manual procedure; if env var is lost, all stored keys are unrecoverable. Acceptable for a small-team internal tool.

---

## ADR-002 — Shared opportunity code, server-reconciled, not Yjs CRDT for multi-phone

**Date**: 2026-05-26
**Status**: Accepted

**Context**: Multiple phones at the same booth need to contribute to one lead.

**Decision**: Short alphanumeric code (5-char, ~60M unique per show) tags each capture. Server merges all captures with the same code into one lead row. No live CRDT sync in v1.

**Consequences**: Much simpler than Yjs + websockets. Slight UX delay: a second phone won't see the first phone's contributions until both have uploaded and processing has completed. Acceptable for v1.

---

## ADR-001 — Always record audio, even with realtime AI assist

**Date**: 2026-05-26
**Status**: Accepted

**Context**: Realtime providers also produce a transcript, so server-side batch transcription seems redundant.

**Decision**: MediaRecorder records EVERY capture as the source of truth. Realtime AI runs in parallel and its TTS is mixed into the recording. Post-processing transcribes the recording regardless, preferring the realtime transcript when present but using server transcription as a verification + fallback.

**Consequences**: Bandwidth + storage cost (every capture has an audio file). Resilience: a realtime session failure doesn't lose data because the recording is local-first. Enables shadow-mode A/B testing across providers without re-running the realtime conversation.
