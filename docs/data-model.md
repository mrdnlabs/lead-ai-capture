# Data Model

Drizzle schema lives at `db/schema/`. One file per table; barrel export in `db/schema/index.ts`.

## Tables

| Table | Purpose |
| --- | --- |
| `auth.users` (Supabase) | Source of truth for user identity. `reps.id` FKs here. |
| `reps` | Application-level user record. Roles: `admin`, `rep`. |
| `shows` | A trade show. Owns lead form + per-show provider config overrides. |
| `show_reps` | Which reps belong to which show. |
| `provider_credentials` | Encrypted API keys (AES-256-GCM, `bytea`). Audited via `credential_access_log`. |
| `provider_configs` | Named provider+model combos, one per `kind` (realtime/transcription/vision/extraction). |
| `provider_ab_assignments` | Per-show A/B test config for two `provider_configs`. |
| `credential_access_log` | Audit log of every decryption. |
| `lead_forms` | One per show. Captures the iCapture CSV header order. |
| `custom_field_definitions` | Configurable fields per `lead_form`. Drives runtime Zod schema for AI extraction. |
| `opportunities` | Unit of multi-phone collaboration. Short alphanumeric `code` unique per show. |
| `leads` | Final merged record per opportunity. `mergedFields` jsonb, `missingFields` jsonb. |
| `captures` | One per phone per recording. Idempotency via `idempotency_key`. |
| `capture_extractions` | Output of the AI pipeline per capture (one row per transcription provider in A/B mode). |
| `media_blobs` | Pointers to Supabase Storage objects (audio + photo). |
| `processing_jobs` | Mirror of Workflow DevKit step state for an ops UI. |
| `csv_exports` | Audit log of generated CSVs. |

## Key invariants

- **Opportunity uniqueness**: `(show_id, code)` is uniquely indexed in `opportunities`.
- **Capture idempotency**: `captures.idempotency_key` is unique; client-generated UUIDv7.
- **Lead per opportunity**: `leads.opportunity_id` is `UNIQUE` — there is at most one lead per opportunity. Multiple captures merge into the same row.
- **Encrypted key format**: `provider_credentials.encrypted_api_key` is `[12-byte IV][16-byte GCM tag][ciphertext]`. The `encryption_key_id` column tells us which KEK env var to load for decryption.

## Enums

Defined in `db/schema/_types.ts`:
- `provider_kind`: openai | gemini | google_stt | deepgram | anthropic
- `provider_config_kind`: realtime | transcription | vision | extraction
- `rep_role`: admin | rep
- `capture_status`: queued | uploaded | processing | processed | failed
- `opportunity_status`: open | merged | closed
- `media_kind`: audio | photo
- `custom_field_type`: text | select | multiselect | boolean | number
- `processing_job_status`: pending | running | succeeded | failed
