# AI Capture — Documentation Index

AI-native trade-show lead capture PWA that replaces the in-booth iCapture experience and exports back to iCapture's Lead Upload Tool.

## Reading order

**Start here:**
1. [goals.md](goals.md) — why this exists, success metrics
2. [requirements.md](requirements.md) — confirmed requirements (source of truth)
3. [personas.md](personas.md) — who uses it and how
4. [user-stories.md](user-stories.md) — concrete Given/When/Then scenarios

**System design:**
5. [architecture.md](architecture.md) — layers, data flow, online vs offline paths
6. [data-model.md](data-model.md) — Postgres schema reference
7. [capture-flow.md](capture-flow.md) — client state machine, offline queue
8. [processing-pipeline.md](processing-pipeline.md) — Workflow DevKit steps, idempotency
9. [realtime-design.md](realtime-design.md) — WebRTC + WebSocket + audio mixing
10. [providers.md](providers.md) — realtime + transcription provider abstraction
11. [icapture-export.md](icapture-export.md) — CSV contract and schema setup
12. [security.md](security.md) — key vault, ephemeral tokens, threat model

**Working in the repo:**
13. [testing.md](testing.md) — fixtures, mocks, adding an E2E test
14. [runbook.md](runbook.md) — deploy, rotate keys, restore from Storage
15. [decisions.md](decisions.md) — ADR log
16. [learnings.md](learnings.md) — running log of surprises during dev

## Quick links

- Approved implementation plan: `C:/Users/dnich/.claude/plans/hey-maybe-you-can-iterative-wreath.md`
- Drizzle schema: `db/schema/`
- Provider adapters: `lib/providers/`
- Key vault: `lib/crypto/keyVault.ts`
