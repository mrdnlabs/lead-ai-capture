# Learnings

Append-only log of surprises and gotchas discovered during development. Newest at top.

---

## 2026-05-26 — Gemini Live ephemeral tokens don't auth browser-direct WSS (Phase 2 blocker)

We implemented the full client + server flow for Gemini Live:
- Server mints ephemeral tokens via `POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens` (body shape: `{ uses, expireTime }` — no `liveConnectConstraints` for AI Studio keys; model/instructions go in the client's `setup` message)
- Client receives `{ token, endpoint, setupMessage }` and opens WSS

But the browser-direct WSS connection to `wss://...v1beta.GenerativeService.BidiGenerateContent` (and v1alpha equivalent) rejects every browser-usable auth mechanism:
- `?access_token=auth_tokens/HASH` query param → close code 1008, "Method doesn't allow unregistered callers"
- `Sec-WebSocket-Protocol` subprotocol with token (in any of 4 variants) → close code 1006 (abnormal, no reason)
- Subprotocols can't contain `/` or space, so `Bearer auth_tokens/HASH` is invalid at the WebSocket constructor

This appears to be a deliberate limitation: AI Studio's `auth_tokens` are meant for **server-side use only**. Direct browser→Gemini WSS auth requires either Vertex AI OAuth or proxying through a server.

**Mitigation for v1**: keep Phase 3's "always-record audio → batch-process server-side" pattern (which works perfectly). Defer realtime UI until we either (a) move to Vertex AI for OAuth-based browser auth, or (b) stand up a server-side WSS proxy on a runtime with persistent connection support (Vercel Functions can't easily hold long WSS connections). All Phase 2 server-side code (token mint, provider adapter, client hook) stays in place — only the capture-page integration is skipped.

## 2026-05-26 — Supabase magic links use PKCE; must open in the same browser

Supabase's `signInWithOtp` uses the PKCE flow by default. When the rep submits the sign-in form, a `code_verifier` cookie is set in **that** browser. The magic link in the email contains a `code` that must be exchanged AGAINST that verifier in `/auth/callback`. If the rep clicks the link in a different browser/profile/incognito window, the exchange fails with "PKCE code verifier not found in storage."

Implication for the PWA: this is fine in practice — the rep requests the link on their phone and clicks it on the same phone. But the magic link CAN'T be tested by requesting on a laptop and clicking on the phone (or vice versa). Document this in the rep onboarding flow.

## 2026-05-26 — Next.js 16 renames `middleware` → `proxy`

Dev server logs the file as `proxy.ts` in timing output even though the file is still named `middleware.ts`. The old name still works (deprecation warning only), but at some point we should rename `middleware.ts` → `proxy.ts` to match the new convention.

## 2026-05-26 — Supabase Marketplace integration gotchas (multiple)

When provisioning Supabase via the Vercel Marketplace:

1. **All Marketplace-provisioned env vars are marked "Sensitive"** by default. Sensitive vars cannot be read back via dashboard or `vercel env pull` — they're only readable by deployed code at runtime. For local dev you have to grab the values from Supabase dashboard directly.
2. **Env var names get prefixed with the resource name** (e.g. `aicapture_POSTGRES_URL` instead of `POSTGRES_URL`). Either rename the resource in Vercel to drop the prefix, or read the prefixed names in code (we use a `lib/env.ts` helper with fallback to standard names).
3. **The auto-generated DB password contains special URL-reserved characters** (`/ & @ * :`). When you paste it into a connection string, you MUST URL-encode it — `new URL(connectionString)` splits at the first unencoded `@` and routes auth to the wrong place. Easiest fix: reset to an alphanumeric-only password (we did this via Supabase dashboard).
4. **Vercel-stored env vars are NOT auto-updated when you reset the DB password.** Production stays broken until you also update the env vars manually (or remove + re-add the Marketplace integration).

## 2026-05-26 — Drizzle + Supabase auth.users overlap

Don't declare `auth.users` in Drizzle schema (via `pgSchema('auth')`). `drizzle-kit generate` will emit `CREATE SCHEMA "auth"` and `CREATE TABLE auth.users` statements, both of which collide with Supabase's existing managed objects. Instead: declare `reps.id` as a plain `uuid PRIMARY KEY` in Drizzle, and add the FK to `auth.users(id)` via a manual SQL setup script (we use `db/supabase/setup.sql`). Same script adds the `auth.users → reps` sync trigger.

## 2026-05-26 — drizzle-kit push needs a TTY; use generate + migrate non-interactively

`pnpm db:push` prompts for confirmation interactively and errors with `Interactive prompts require a TTY terminal` under our PowerShell wrapper. Workaround: use `pnpm db:generate` (writes SQL files non-interactively) followed by `pnpm db:migrate` (applies them non-interactively). This is also the production-correct pattern.

## 2026-05-26 — pnpm 11 build-script approval gate is per-package

`pnpm install` requires explicit approval for native build scripts (sharp, esbuild, unrs-resolver). The `onlyBuiltDependencies` array in `pnpm-workspace.yaml` did NOT take effect for us; only `dangerouslyAllowAllBuilds: true` worked. Without approval, `pnpm <script>` fails with `[ERR_PNPM_IGNORED_BUILDS]` even for unrelated scripts because pnpm runs a dependency-status check first.

---

## 2026-05-26 — npm package name forbids capital letters

`create-next-app .` derives the package `name` from the directory name. Our directory was `20260526_AiCaptureLeadCapture` (mixed case). npm naming rules forbid capitals, so the scaffold errored. Workaround: scaffold into a subdir (`ai-capture`) then move files up.

---

## 2026-05-26 — iCapture has no public write API (May 2026)

Confirmed via the Cvent developer portal and multiple third-party sources. The only ingestion path for third parties is the **Lead Upload Tool** (CSV/XLSX). Our app exports CSV; user manually uploads after the show. Don't waste time looking for a REST endpoint to POST leads.

---

## 2026-05-26 — Gemini Live is WebSocket-only; OpenAI Realtime is WebRTC primary

Both provide ephemeral tokens for direct client connection, but the transports differ. Our `useRealtimeAssist` hook must branch on `transport: 'webrtc' | 'websocket'`. Audio mixing into the MediaRecorder source works identically either way via `MediaStreamAudioDestinationNode`, but the chunked send/receive format differs (Gemini = 16 kHz PCM in, 24 kHz PCM out).
