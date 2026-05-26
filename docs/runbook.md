# Runbook

## First-time deploy

1. `vercel link` — link the repo to a Vercel project
2. Install **Supabase** from the Vercel Marketplace — auto-populates `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`
3. Generate KEK: `openssl rand -base64 32` → `vercel env add KEY_ENCRYPTION_KEY production`. Repeat for `preview` and `development`. **Save a copy somewhere safe** — losing it makes all stored provider keys unrecoverable.
4. `vercel env pull` to pull env vars locally
5. `pnpm db:push` to apply Drizzle schema to Supabase
6. Run Supabase SQL (from `db/supabase/policies.sql`) to set up RLS policies and the auth.users → reps sync trigger
7. `pnpm db:seed` to seed a demo show + reps + opportunity
8. `vercel deploy --prod`

## Rotating KEK

1. Generate new KEK: `openssl rand -base64 32`
2. `vercel env add KEY_ENCRYPTION_KEY_v2 production` with the new key
3. `vercel env add ACTIVE_KEY_ENCRYPTION_KEY_ID production` with value `v2`
4. Deploy. All new encryptions use v2. Old records still decrypt via the original `KEY_ENCRYPTION_KEY` (which maps to id `v1`).
5. Optional: run a background re-encryption job to migrate all rows to v2, then remove the v1 env var.

## Rotating a provider API key

1. Admin generates new key in OpenAI/Gemini/etc. dashboard
2. Admin opens `/admin/providers`, clicks "Rotate" on the existing credential
3. Paste new key → submitted via server action → encrypted with current active KEK → replaces ciphertext (old key audit-logged)
4. New key takes effect immediately for next call

## Recovering from a failed Workflow

1. Check `processing_jobs` table for the `capture_id`
2. View error in `processing_jobs.error`
3. If transient: re-trigger via Workflow DevKit ops UI (idempotent on `capture_id`)
4. If model schema mismatch: update `custom_field_definitions`, re-trigger

## Restoring media from Supabase Storage

Supabase Storage has bucket-level recovery on Pro plan. For free plan, audio/photo loss is unrecoverable; consider a nightly export to S3-compatible cold storage (TODO).
