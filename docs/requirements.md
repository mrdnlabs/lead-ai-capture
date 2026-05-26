# Requirements

Source-of-truth requirements confirmed with the user. Changes to these require user approval.

## Capture

- **R1** Web app (PWA), cross-platform iOS Safari + Android Chrome, installable to home screen.
- **R2** Per capture, the rep can take a photo of a name badge.
- **R3** Per capture, **audio is always recorded** (even when offline) for evidence and later processing.
- **R4** When connectivity is good and the rep enables AI assist, a **realtime voice agent** asks gap-filling questions DURING the recording. The audio recording captures both the rep's narration and the AI's prompts and the rep's answers.
- **R5** When connectivity is poor or absent, the app still records audio and a photo; no AI conversation is attempted.
- **R6** All captured audio is **post-processed server-side** regardless of online state — transcribed, structured-extracted into the iCapture lead schema, and merged into the lead record.

## Offline + sync

- **R7** Photos + audio queue in IndexedDB when offline. No data loss across browser restarts.
- **R8** Background Sync used on Android; foreground retry-on-focus fallback on iOS.
- **R9** A visible "X queued — tap to sync" pill lets the rep manually flush the queue.

## Multi-phone

- **R10** Multiple phones at the same booth can contribute to one **shared opportunity** via a short alphanumeric code.
- **R11** Server reconciles all captures tagged with the same opportunity code into a single merged lead record. No real-time CRDT sync needed in v1.

## Display mode

- **R12** Same app, different route, browses all leads for the current show with missing-field chips.
- **R13** Display mode offers a QR/code share UX for a second phone to join an opportunity.

## Auth

- **R14** Supabase Auth via Vercel Marketplace, magic-link login per rep. Each capture owned by a rep, scoped to a show.
- **R15** Role-based gating: `rep` vs `admin`. Admin-only routes for credentials, configs, analytics.

## iCapture integration

- **R16** Export endpoint generates a CSV matching the user's iCapture event lead form (custom qualifying questions included).
- **R17** The rep uploads the CSV manually into iCapture's **Lead Upload Tool**. No iCapture write API exists publicly as of May 2026.
- **R18** Lead form schema (the set of custom fields) is configured in-app by pasting a sample iCapture export.

## Providers (pluggable)

- **R19** Realtime voice is pluggable between **OpenAI `gpt-realtime` (WebRTC)** and **Gemini `gemini-3.1-flash-live` (WebSocket)**.
- **R20** Batch transcription is pluggable between **OpenAI `gpt-4o-transcribe`**, **Gemini audio**, **Google Cloud STT v2 Chirp 3**, and **Deepgram Nova-3**.
- **R21** Admin can A/B test two providers head-to-head on the same captures.

## Security

- **R22** API keys (OpenAI, Gemini, Google, Deepgram, Anthropic) are entered once by an admin in-app and stored AES-256-GCM-encrypted in Postgres.
- **R23** Mobile clients **never** receive long-lived API keys. They receive short-lived ephemeral tokens (1–30 min TTL) minted by the server per session.
- **R24** Every key decryption is audited in `credential_access_log`.

## Testability

- **R25** End-to-end testable by an AI coding agent: fixture audio + badge images, mocked AI provider responses, Playwright network/permission controls.
- **R26** Offline mode and multi-phone reconciliation each have dedicated E2E specs.

## Docs

- **R27** All design, architecture, and learnings live under `/docs/` with an `index.md` entry point.
