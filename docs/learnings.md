# Learnings

Append-only log of surprises and gotchas discovered during development. Newest at top.

---

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
