# Backlog

Things that are intentionally NOT in v1 but worth doing later. Ordered by likely return-on-investment.

## pgvector pre-filter for dedupe at scale

**Trigger**: when a single show consistently has > 300 active leads.

**Why**: at 500+ candidates, the all-leads-in-context dedupe call hits ~45K tokens (4% of Gemini 2.5 Flash's window) and takes 5-10s of latency. Manageable but not snappy.

**How**:
1. Enable the `pgvector` extension in Supabase (one-line SQL).
2. Add a `lead_identity_embedding` column (`vector(768)` for Gemini's `text-embedding-004`) to `leads`.
3. When the orchestrator merges a lead, also compute and store an embedding of `"<name> <company> <email>"`.
4. Modify `findDuplicateLead` to first query the top-20 nearest neighbors by cosine similarity, then pass *only those* to the LLM. Brings prompt back to ~1-2K tokens and ~1-2s latency regardless of total lead count.

**Cost**: one extra Google embedding call per capture (~$0.000003 per call — negligible).

## Live realtime voice (Gemini Live / OpenAI Realtime in-browser)

**Trigger**: when reps consistently miss capturing key fields and need real-time gap-filling prompts.

**Why deferred**: Gemini Live's WSS auth doesn't accept browser-direct ephemeral tokens (1006/1008 close codes — documented in [learnings.md](learnings.md)). The "always-record + AI post-process" pattern covers the core need.

**How to unblock**:
- **Option A — Vertex AI**: switch from AI Studio API keys (`AIza…`) to Vertex AI OAuth. Requires a GCP project + service account, more complex but Vertex's WSS accepts browser auth properly.
- **Option B — Server-side WSS proxy**: stand up a small Node service on Cloudflare Workers or Render that holds the WSS to Gemini and pipes audio bidirectionally to the browser. Vercel Functions can't hold persistent connections.
- **Option C — Wait for Google**: Google may eventually fix AI Studio ephemeral tokens for browser WSS auth.

## AI-driven follow-up prompts on the rep's phone

**Trigger**: when reps say they keep forgetting which fields are missing per lead.

**Why deferred**: the `missingFields` chips on the display page surface the gap; reps can just record another note that mentions the person — dedupe routes it to the right lead. No explicit UI needed.

**How**: web Push Notifications API — fires when a capture finishes processing with required-field gaps. Tap notification → opens capture page, hint banner shows "Sarah Chen still needs: interest_level, decision_maker."

## A/B testing assignment UI (Phase 5 finish)

The shadow-run logic is in place; the assignment table can be inserted via SQL. UI for admins to create/edit `provider_ab_assignments` is missing.

## Custom SMTP in Supabase (production email)

The Supabase free SMTP rate-limits ~3-4 magic links per hour. For real production usage, configure a custom provider (Resend / Postmark) in Supabase Auth → Emails → SMTP. 2-minute setup.

## Vercel deployment protection

Preview deployments currently require Vercel auth to access (default for Hobby team). For phone testing during dev: either disable in Vercel project settings → Deployment Protection, or promote to production (`vercel deploy --prod`) which gets a stable URL with no protection.

## Storage quota monitoring

Supabase free tier: 1 GB storage. Trade-show audio at ~50KB/min plus badge photos at ~30KB each = ~100 leads ÷ 1GB ≈ 5000 captures before exhaustion. Pro tier ($25/mo) gets 100 GB. No monitoring/alerts wired up yet.
