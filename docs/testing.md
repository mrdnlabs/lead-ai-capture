# Testing

The two suites Claude can re-run end-to-end against the deployed app are documented below. Both drive the real production endpoints (auth, `/api/realtime/token`, `/api/realtime/vision-extract`, `/api/captures`, the live Gemini WSS) — they're not unit tests, they're integration tests.

The aspirational Playwright / Vitest layer is described at the bottom under [Planned](#planned).

---

## TL;DR — run everything

From a Windows shell at the repo root:

```bash
# One-time: seed the Demo Show with test leads. Idempotent.
pnpm tsx scripts/seed-test-leads.ts

# Matching / conversational scenarios — 17 scenarios driving the real WSS.
# ~4-7 min, ~$0.30 of API spend.
pnpm tsx scripts/test-scenarios.ts

# Vision / OCR scenarios — 8 image fixtures POSTed to /api/captures.
# ~2-3 min, ~$0.20 of API spend.
pnpm tsx scripts/test-vision.ts

# Static type-check (no API spend).
pnpm typecheck
```

Each run archives a JSON report to `tests/scenario-runs/<ISO-timestamp>-{summary,vision}.json` that Claude can `Read` directly to triage failures.

---

## Prerequisites

| Item | How |
|---|---|
| `.env.local` | Supabase URL + service-role key + `aicapture_POSTGRES_URL_NON_POOLING` |
| Test rep | An email that already has a row in `auth.users`. Defaults to `anthropic@davidnicholl.com` — override with `AICAPTURE_TEST_REP_EMAIL` |
| Target base URL | Defaults to `https://ai-capture.vercel.app` — override with `AICAPTURE_TEST_BASE_URL` |
| Test show | A show with slug `demo` and a lead form. Created once via `scripts/seed-gemini.ts` |
| Test leads | TST001–TST011, seeded by `scripts/seed-test-leads.ts` |
| Provider credentials | Either env var `DEFAULT_GEMINI_API_KEY` or a `provider_credentials` row resolved through `resolveProviderForKind` |

---

## Suite 1 — matching scenarios (`scripts/test-scenarios.ts`)

### What it does

1. Authenticates as the test rep via Supabase admin `generateLink` + the real `/auth/callback` route. Cookies are captured for re-use (same as a real PWA session).
2. For each scenario: `POST /api/realtime/token` to get the real production prompt + tools, opens a WebSocket to Gemini Live with the returned token, sends `setupMessage`.
3. Sends each "rep turn" as `realtimeInput.text` (same wire format the production text-input box uses — text instead of voice keeps the test deterministic enough to assert on).
4. Observes `serverContent` + `toolCall` and replies with `toolResponse`, exactly as `useRealtimeAssist` does.
5. Compares against the scenario's `expected` block.

### Assertion options

| Option | Effect |
|---|---|
| `matchOpportunityCode: 'TST001'` | AI must call `match_existing_lead` with that opportunity code (at least once across the conversation) |
| `noMatchExpected: true` | AI must NOT call `match_existing_lead` at all |
| `capturedFields: { first_name: /sarah/i, email: 'acme.io' }` | After the conversation, the named live-fields must contain matching values (regex or substring) |
| `aiAsks: /spell|last name/i` | The concatenation of every AI turn must match this regex |
| `aiDoesNotAsk: /how do you spell.*bill/i` | The concatenation must NOT match (use for "don't bother spelling common names" tests) |
| `minFieldConfidence: { email: 1.0 }` | A captured field must have been written at >= this confidence |

### Test data prerequisites

Run `scripts/seed-test-leads.ts` once. It creates these leads in Demo Show (idempotent — skips ones already present):

| Code | Name | Company | Title | Email | Purpose |
|---|---|---|---|---|---|
| `TST001` | David Chen | Acme Robotics | Director of Engineering | david.chen@acmerobotics.io | Phonetic-sibling, exact-match, email-only-match targets |
| `TST002` | Dave Chan | Acme Software | Principal Engineer | d.chan@acmesoftware.com | Phonetic-sibling distractor — different person |
| `TST003` | Stephen Tatem (sic) | Northwind Logistics | VP Operations | s.tatum@northwind.co | Typo-correction target (stored "Tatem", rep says "Tatum") |
| `TST004` | Priya Iyer-Walsh | Helio Cell | Head of Product | priya@helio-cell.com | Hyphenated-name handling |
| `TST005` | John Smith | Globex | Sales Director | jsmith@globex.example | Common-name + two-johns disambiguation |
| `TST006` | Sarah Okafor | Acme Robotics | Engineering Manager | sarah.okafor@acmerobotics.io | Same-email-domain distractor (no match expected) |
| `TST007` | Marcus | BlueRiver Analytics | — | — | Sparse-info match (first name + company only) |
| `TST008` | Yuki Watanabe-Hartmann | NorthStar Aerospace | Chief Scientist | yuki.wh@northstar.aero | Long unambiguous name |
| `TST009` | Emma Lindqvist | Orbit Labs | Senior PM | emma.l@orbitlabs.co | Unusual-name sanity |
| `TST010` | John Smith | Northwind Logistics | Operations Manager | john.smith@northwind.co | **Second John Smith** — two-johns ambiguity |
| `TST011` | Bill Jones | Apex Supplies | Procurement | bill.jones@apex-supplies.com | Common-name skip-spelling test |

### Scenario catalog (17 scenarios)

| # | Name | Tests | Rep turns (1-line summary) | Expects |
|---|---|---|---|---|
| 1 | `new-lead` | Brand-new lead with no overlap | "Olivia Park / Fjord Analytics / olivia@fjord-analytics.com" | no match; first_name=olivia, email captured |
| 2 | `exact-match-david-chen` | Returning lead, exact name+company | "David Chen from Acme Robotics is back" | match TST001 |
| 3 | `phonetic-sibling` | Dave Chen ≈ David Chen at Acme Robotics | "Dave Chen from Acme" → "Acme Robotics specifically" | match TST001 (not TST002) |
| 4 | `typo-correction` | Stored "Tatem" vs spoken "Tatum" | "Stephen Tatum from Northwind, T-A-T-U-M" | match TST003 + last_name=Tatum |
| 5 | `sparse-info-match` | First name + company only | "Marcus from BlueRiver is back" | match TST007 |
| 6 | `same-surname-different-person` | Different person, same last name | "Linda Smith from Hawthorne Bio" | NO match |
| 7 | `shared-email-domain` | Same email domain as existing, different person | "Theo Nakamura, theo@acmerobotics.io" | NO match |
| 8 | `similar-company-different-firm` | "Acme Hardware" vs existing "Acme Robotics" / "Acme Software" | "Lila Mendes from Acme Hardware" | NO match |
| 9 | `first-name-only-wait` | Rep gives only first name in turn 1 | "Dave just stopped by" → "His last name is Chen" → "Acme Robotics" | match TST001 only after last-name turn; AI must ask for last name |
| 10 | `delayed-last-name-reveal` | Info dribbles across 4 turns | "David from Acme" → "Acme Robotics" → "last name Chen" → "interested in enterprise" | match TST001; AI must ask for missing pieces |
| 11 | `two-john-smiths-disambiguated-upfront` | Two John Smiths in system; rep names company | "John Smith from Globex" | match TST005 (not TST010) |
| 12 | `two-john-smiths-ambiguous-must-ask` | Two John Smiths; rep gives no company | "John Smith stopped by again" → "the one from Northwind" | match TST010; AI must ask which one |
| 13 | `common-name-skip-spelling` | Bill Jones — both names common | "Bill Jones from Apex Supplies" | match TST011; AI does NOT ask for spelling |
| 14 | `unusual-name-must-spell` | Pete Pikulski — unusual surname | "Pete Pikulski stopped by, P-I-K-U-L-S-K-I" | last_name=pikulski; AI asks for spelling |
| 15 | `email-only-match` | Match on email alone, no name | "I have an email: david.chen@acmerobotics.io" | match TST001 |
| 16 | `similar-name-different-person-no-match` | David Marquez ≠ David Chen | "David Marquez from Quantis Robotics" | NO match |
| 17 | `email-spelling-verification` | Voice-given email must be read back | "Anika Khoury / anika@plinth-software.com" → spell confirm | email captured at confidence ≥ 1.0; AI reads it back |

### Known flaky scenarios

These three are AI-calibration issues, not framework bugs. They pass intermittently:

- `new-lead` — AI sometimes runs out of turns before capturing email
- `typo-correction` — AI sometimes echoes stored "Tatem" instead of applying the rep's corrected "Tatum"
- `same-surname-different-person` — AI sometimes false-flags TST006

With the always-confirm policy in place, the matching false-positives are harmless in production (rep taps "No" on the banner). The tests still flag them so we have a signal when calibration drifts.

### Materials

- **No external materials** — scenarios are pure text strings inlined in `scripts/test-scenarios.ts`
- **Generated archives** — `tests/scenario-runs/<ISO>-summary.json` per run, with full transcript + tool calls + assertions per scenario

---

## Suite 2 — vision / OCR scenarios (`scripts/test-vision.ts`)

### What it does

1. Authenticates as the test rep (same helper as Suite 1).
2. For each image fixture:
   1. POSTs multipart `/api/captures` with the fixture as `photo` and no audio
   2. Polls `captures.status` every 2s up to 180s for `processed`
   3. Reads the resulting `leads.merged_fields` and checks against expected
3. **Safe cleanup**: snapshots pre-existing opportunity IDs *before* the run; only deletes opportunities that didn't exist before. Dedupe-re-pointed captures never nuke real user leads.

### Assertion options

| Option | Effect |
|---|---|
| `emptyOk: true` | Image is expected to yield ~0 extractable fields (back of card, logo-only, etc.) |
| `capturedFields: { first_name: /milly/i }` | `merged_fields[key]` must contain matching string |

### Test data prerequisites

Image fixtures live in [`tests/fixtures/`](../tests/fixtures/README.md). Already checked into the repo — no setup needed.

### Scenario catalog (8 scenarios)

| # | Fixture | What it tests | Expected |
|---|---|---|---|
| 1 | `badges/fake-badge-sarah-chen.png` | Generated synthetic baseline — deterministic | first/last name + email + company + title |
| 2 | `badges/name-badges.jpg` | Magnetic name badge: "Milly Francis · Dental Nurse · Smiles Dentists" | name + title + company |
| 3 | `badges/employee-name-badge.jpg` | Conference badge "Paul Smith · Stictly Ltd · 4th Online Services Conference" — contains a real-world OCR ambiguity ("Stictly" vs "Strictly") | first/last name + company (accepts either spelling) |
| 4 | `badges/wikiconf-uk-2012.jpg` | Distant photo of a table covered in badges | mostly empty (max ~3 fields) |
| 5 | `cards/choe-kwangmo.jpg` | Clean modern business card (CC0) — name, org, phone, email, website | first_name + company + email |
| 6 | `cards/diplomatic-first-secretary.jpg` | Multi-line title, two-column layout | full name + title + company |
| 7 | `cards/british-library.jpg` | Back of card — only the tagline "THE WORLD'S KNOWLEDGE" | empty (no contact data) |
| 8 | `cards/andres-rincon.jpg` | Logo-only mockup, no contact text | empty (logo doesn't count as contact) |

### Materials

- **Image fixtures** — [`tests/fixtures/{badges,cards}/`](../tests/fixtures/) with attribution + license info in `tests/fixtures/README.md`
- **All web-sourced images are CC BY-SA 4.0 / CC BY 2.0 / CC0 / public domain.** Attribution required on CC BY licenses — keep the README alongside the files when redistributing.
- **Generated archives** — `tests/scenario-runs/<ISO>-vision.json` with the merged_fields snapshot + pass/fail per case

---

## Reading scenario archives

Both suites write a JSON archive per run to `tests/scenario-runs/`. Quick triage recipe:

```bash
# Find the most recent matching run
ls -t tests/scenario-runs/*-summary.json | head -1

# Pretty-print a specific scenario's transcript + tool calls
node -e "
  const r = require('./tests/scenario-runs/2026-05-27T16-04-11-284Z-summary.json');
  const s = r.results.find(x => x.scenario.name === 'typo-correction');
  for (const t of s.transcript) {
    if (t.role === 'rep') console.log('REP:', t.text);
    else {
      if (t.text) console.log('AI :', t.text);
      if (t.toolCalls) for (const tc of t.toolCalls)
        console.log('AI ⚙', tc.name, JSON.stringify(tc.args));
    }
  }
"
```

You can also paste a filename into your session with me and I'll `Read` it directly.

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/realtime/token HTTP 500` | Vercel Function cold-start or transient Gemini hiccup | Retry — the harness backs off automatically (3 tries) |
| `Gemini HTTP 503` | Flash model overloaded | Retry — the harness backs off (5 tries with exp backoff) |
| `expected field 'X' to be captured, but none` | AI ran out of turns or got confused on a low-context capture | Often AI-calibration flakiness, not regression. Repeat the scenario in isolation: edit the script to filter to one scenario name |
| `expected NO match, but AI flagged TSTxxx` | AI matching is too loose | Tighten the agent prompt rules in `lib/realtime/agentContext.ts`; rerun |
| `expected AI to ask /pattern/, but AI never did` | AI didn't follow conversation rule | Check the prompt — the rule may need stronger language |
| `Capture not processed within 180000ms` | `processCapture` stuck (see Issue #2 in `docs/learnings.md`) | Investigate the capture's last `status` via DB; possibly missing try/finally in pipeline |

---

## What's NOT yet automated

These would be Claude-runnable later but aren't today — manual smoke tests in the meantime:

- **Match-banner UX in the PWA** — the test scripts assert that the AI *called* `match_existing_lead`. They don't simulate a rep tapping the Yes/No buttons that follow. Real UI testing needs Playwright with a logged-in PWA context.
- **Auto-prefill / rollback in the UI** — same reason
- **Returning-lead lookup latency** on the in-PWA capture-then-recap-screen workflow — needs a real device test
- **Offline → online drain** — needs Playwright `context.setOffline(true)` to simulate

For these, generate a fresh magic link, install the PWA on your phone, and run through the scripted scenarios manually. Each matching scenario above is essentially a script you can read out loud.

---

## Planned (not yet built)

The Playwright suite described below is the long-term goal — when the matching + vision suites stabilize and we want full UI-state coverage in CI.

- **Vitest** unit tests — co-located as `*.test.ts` next to source. Examples: `lib/crypto/keyVault.test.ts` (not yet written). Run with `pnpm test`.
- **Playwright** end-to-end tests — `tests/e2e/`. Run with `pnpm test:e2e`.

### Playwright media fixtures (planned)

`tests/e2e/fixtures/media.ts` would launch Chromium with:

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream
--use-file-for-fake-audio-capture=<wav path>
--use-file-for-fake-video-capture=<y4m path>
```

The wav/y4m path swapped per test via context options. Lets a Playwright test drive the capture flow end-to-end with no real mic/camera.

### Mocking AI providers (planned)

`tests/e2e/mocks/aiGateway.ts` — Playwright route interceptor for `https://gateway.ai.vercel.com/*` returning canned JSON keyed by request hash. Recorded once with `PLAYWRIGHT_RECORD=1` against real models, then replayed in CI.

`tests/e2e/mocks/openaiRealtime.ts` and `mocks/geminiLive.ts` — intercept the WebRTC offer / WebSocket connect. Realtime suites disabled by default; `@realtime` tagged suite hits live APIs behind a flag.

### Spec inventory (planned)

- `capture.spec.ts` — basic online capture flow
- `offline.spec.ts` — `context.setOffline(true)`, capture, assert Dexie row, go online, assert upload + lead row
- `multiphone.spec.ts` — two browser contexts, same opportunity code, both capture, assert single merged lead
- `extraction.spec.ts` — fixture audio + badge → assert exact `mergedFields`
- `realtime-openai.spec.ts` / `realtime-gemini.spec.ts` — token + connect paths against stubs
- `ab-transcription.spec.ts` — A/B mode produces two `capture_extractions` rows
- `admin-credentials.spec.ts` — encrypted at rest, last4 only in UI
- `match-banner.spec.ts` — AI flags match → banner shows → rep taps Yes → checklist prefills → submit → DB confirms re-pointed capture
- `team-invite.spec.ts` — admin mints invite → load /join/<token> in second context → membership row created
