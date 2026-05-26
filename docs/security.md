# Security

## Threat model

We hold bearer credentials with billing impact (OpenAI, Gemini, Google Cloud, Deepgram, Anthropic API keys). A leaked key can rack up thousands of dollars before detection. We treat key storage as the #1 security concern.

**Out of scope** for v1: full HIPAA-style audit, customer-managed KEKs, hardware security modules.

## Key vault

Implementation: `lib/crypto/keyVault.ts`. Tests: `lib/crypto/keyVault.test.ts`.

- Algorithm: **AES-256-GCM**
- Ciphertext layout: `[12-byte IV][16-byte GCM tag][ciphertext]`
- KEK: 32 random bytes, stored in env var `KEY_ENCRYPTION_KEY` (base64). Generate with `openssl rand -base64 32`.
- Key rotation: set `ACTIVE_KEY_ENCRYPTION_KEY_ID=v2`, store the new KEK in `KEY_ENCRYPTION_KEY_v2`, keep the old in `KEY_ENCRYPTION_KEY` (or `KEY_ENCRYPTION_KEY_v1`) so old records still decrypt. Re-encrypt on next access.

## Database layer

- `provider_credentials.encrypted_api_key` is `bytea` (Postgres binary). Never `text`, never `jsonb`.
- `encryption_key_id` (text) records which KEK was used so we can rotate without re-encrypting all rows at once.
- Only the **last 4 characters** of a key are shown in the admin UI, never the full key.

## Audit

Every decryption writes a row to `credential_access_log`:
- Who triggered it (`accessed_by_rep_id`)
- Why (`purpose` — e.g. `realtime_token_mint`, `batch_transcription`)
- What context (`context_id` — capture ID or session ID)
- When (`accessed_at`)

`provider_credentials.last_used_at` and `.use_count` are also updated for quick dashboards.

## Mobile client never gets raw keys

- **Realtime**: client calls `/api/realtime/token` → gets short-lived ephemeral token + endpoint → connects directly to OpenAI/Gemini. Long-lived key stays on server.
- **Transcription, vision, extraction**: client uploads media to Supabase Storage → server-side Workflow uses the decrypted key to call the provider → result stored in DB. Client never calls a provider directly.

## Token endpoint hardening

- Rate-limited per rep (10 mints/min)
- TTL set as short as the provider allows (60s for OpenAI, configurable for Gemini)
- `instructions`, `max_duration`, `voice`, and `model` pre-baked server-side — client can't override

## Network egress

Audit periodically (Phase 2 verification step) that no outbound request from a mobile client contains a long-lived `sk-*` / `AIza*` / `dg-*` token.
