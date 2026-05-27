# UI/UX Designer Brief — AI Capture

> Use this brief when prompting Claude Design (or any UI/UX designer) to redesign the app. Attach the files listed in **§ Files to share with the designer** so they have ground truth instead of inferring from this doc.

---

## 1. Product in one paragraph

**AI Capture** is a mobile-first PWA that replaces clunky trade-show lead-capture apps (specifically iCapture, which the company is locked into for downstream processing). A booth rep snaps a photo of a lead's badge or business card, optionally chats with a live AI assistant while the badge is being read, and the app produces a structured lead row. At end of show the rep exports a CSV that drops into iCapture's official Lead Upload Tool.

The app is built around the constraint that **the rep is standing, holding the phone in one hand, often mid-conversation with a live human, and can't afford more than a few taps per capture.**

---

## 2. Who uses it

Source of truth: [docs/personas.md](personas.md). Summarized:

| Persona | Context | What they need from the UI |
|---|---|---|
| **Riley — Booth Rep** | On their feet 6–10 hrs/day. One-handed phone. Spotty Wi-Fi. Hates typing. | 5–15s per capture, voice-first, big tap targets, never lose a lead to a network blip |
| **Sam — Booth Lead** | Same as Riley + responsible for the whole show. Sets up the schema before day 1. | Mid-show progress visibility, CSV export, can invite/manage reps |
| **Alex — App Admin** | Internal IT. Configures provider keys + AI A/B tests. Investigates failures. | Dense info-density admin views, not optimized for phone |
| **Pat — Post-show Ops** | Receives the CSV after the show. Never uses the app itself. | Just gets a clean CSV — no UI here, but the export flow needs to be obvious to Sam |

**Primary persona is Riley.** Everything else can be desktop-grade dense.

---

## 3. Critical user flows (current behavior)

Each flow is described as actually-built behavior, not aspirational.

### 3a. First-time sign in
1. Rep opens `https://ai-capture.vercel.app` on phone
2. Single screen with email field → submits → magic link emailed
3. Tap link in email → lands back on home → "Install to Home Screen" prompt (PWA)

### 3b. Capture a lead (online, with AI assist) — the hot path
1. Rep opens the home screen → taps the show card → routed to `/s/[showCode]/capture`
2. Capture screen has **three** interactive zones from top to bottom:
   - Voice block: "Start recording" button + AI-assist toggle + Simulate-offline toggle + Debug-mode toggle
   - When live: a "Returning lead?" banner (if AI flagged a match), a Checklist (showing required fields with green checks as they fill), a transcript bubble, and an attachment toolbar (camera + browse + text input + send)
   - Submit button at the bottom: "Stop & submit" while recording, "Submit capture" while not
3. Rep records audio, attaches a photo, AI reads the photo + asks gap-filling questions out loud
4. When done, rep hits Submit (or the AI calls `end_conversation` and submit fires automatically)
5. Success screen: "New capture" or "View leads"

### 3c. Capture (offline)
- Same UI; toggling "Simulate offline" (or actual airplane mode) routes the submit into a local Dexie outbox
- A "queued" success state appears; auto-drains when connectivity returns

### 3d. View leads
- `/s/[showCode]/leads` — list of captured leads grouped by opportunity, with missing-field chips and an Export CSV button
- Currently a plain table-style list. Likely the biggest design upgrade opportunity.

### 3e. Admin — set up a new show
- `/admin/shows` (list + create)
- `/admin/shows/[showId]/lead-form` (paste a sample iCapture CSV → AI infers schema → rep edits → save)
- `/admin/providers` and `/admin/configs` (AI provider keys + model picks)
- `/admin/analytics` (A/B / cost / latency dashboard — sparsely populated)

---

## 4. Current screens — what's there now

### Capture screen (`/s/[showCode]/capture`)
A single scrollable card. Top: title + subtitle. Then a stacked sequence of cards/sections (voice, attachment toolbar, AI panel, submit). The AI panel only appears once a live session starts.

**Known UX issues:**
- Dense vertical stack — feels cluttered when AI is live (banner + checklist + transcript + attachment row + submit all on one screen)
- Status indicators (AI status, image extract status, simulated-offline, debug) compete for attention
- Submit button is far from the recording control; can be missed
- The "AI assist" toggle is buried among other checkboxes (simulate-offline, debug) that aren't peer concepts
- No visual rhythm or breathing room — everything is 12px gaps
- Color palette is default Tailwind grays + green submit; no brand
- Type hierarchy is weak: same text-sm everywhere
- Dark mode does not exist
- Tap targets for the attachment toolbar (📷 / 📎 buttons) are minimum legal size, could be more generous

### Leads list screen (`/s/[showCode]/leads`)
A grouped list of leads with their merged fields, captured-by chips, and an export button. No filtering, no search, no bulk select.

### Admin screens
Plain tables and forms. Functional but visually unconsidered.

### Sign-in
Single centered email input. Clean enough; not a priority.

---

## 5. Constraints

### Tech
- **React 19** + **Next.js 16 App Router** (RSC + client components)
- **Tailwind 4** (no design system library yet — `shadcn/ui` is listed as the eventual target but not installed)
- **PWA** via Serwist (installable to home screen on iOS and Android)
- **Mobile-first**: iOS Safari + Android Chrome are the targets. Desktop is a fallback.
- Currently uses no icon library — just emoji glyphs. Could adopt one (Lucide is common with shadcn).

### Behavior
- **One-handed thumb operation must be possible** on the capture screen
- **Touch targets ≥ 44×44 pt** (Apple HIG) for any primary action
- Capture screen must remain functional **offline** — visual state for queued / re-syncing should be clear
- Recording, AI assist, and submit must all be reachable without scrolling on a 6.1" phone
- "Simulate offline" and "Debug mode" toggles are dev-mode features — a real rep should never see them. Currently they live in the capture screen for testing; a real release should hide them behind a developer panel or `?dev=1` flag
- The capture page must surface the **opportunity code** prominently when a match is confirmed (currently shown only in a tiny line of text)

### Brand
- No existing brand or palette. Greenfield. Designer can propose.
- Trade-show context — leans toward energetic / confident / not corporate-stuffy
- Must not clash with iCapture's red/teal palette since reps may have both apps open

### Accessibility
- WCAG 2.1 AA contrast minimums
- Voice-driven nature of the app means it's already friendlier to low-vision users than a typing-heavy app, but UI text contrast still matters
- Captioning of the AI's spoken responses (already done — transcript bubble); design should keep it readable in bright outdoor light

---

## 6. What we want from the redesign

In order of impact:

1. **Capture screen** — the hot path. Make it feel fast, calm, one-handed. Should be visually obvious what state the rep is in (idle / recording / AI thinking / queued / done).
2. **Leads list** — make it browsable and triagable. Filter by date / rep / missing-fields. Tap a lead for detail. Maybe card-based.
3. **Identity / brand** — palette, typography scale, an icon set. Even a minimal design system.
4. **Admin screens** — they don't need to be beautiful, but the show-setup wizard (paste CSV → confirm fields) deserves attention since it's the on-ramp for every new show.
5. **Sign-in / install** — minor polish, primarily so the first-run experience feels intentional.

**Out of scope** (defer):
- Native iOS/Android apps (PWA only for now)
- Dashboard with charts / analytics (admin/analytics page exists but isn't a priority surface)
- Internationalization

---

## 7. Files to share with the designer

When prompting Claude Design (or sending to a human designer), attach **all** of the following so they're working from ground truth, not this brief alone:

### Screens (current state — recommend capturing fresh screenshots)
- `/auth/signin` (sign-in)
- `/s/demo/capture` (capture, idle state)
- `/s/demo/capture` (capture, AI-assist live, with a returning-lead banner + checklist + transcript) ← the most important screenshot
- `/s/demo/leads` (display)
- `/admin/shows` (list)
- `/admin/shows/<id>/lead-form` (CSV paste-in setup)
- `/admin/providers` and `/admin/configs` (admin pages — for completeness)

### Code references (the designer should read these to understand current structure)
- `app/(capture)/s/[showCode]/capture/CaptureRecorder.tsx` — the capture screen; biggest design target
- `app/(display)/s/[showCode]/leads/page.tsx` — leads list
- `app/(admin)/admin/shows/[showId]/lead-form/LeadFormSetup.tsx` — the show-setup wizard
- `app/auth/signin/page.tsx` — sign-in
- `app/page.tsx` — home (which shows accessible to this rep)

### Doc references
- This file ([docs/design-brief.md](design-brief.md))
- [docs/personas.md](personas.md) — full persona context
- [docs/user-stories.md](user-stories.md) — Given/When/Then stories per persona
- [docs/goals.md](goals.md) — why the product exists
- [docs/capture-flow.md](capture-flow.md) (if present) — the capture state machine

---

## 8. Suggested prompt to Claude Design

> I'm redesigning a mobile-first PWA called **AI Capture** — it's a voice-driven trade-show lead capture app for booth reps. Reps stand in noisy halls with one hand on a phone and need to capture a lead in 5–15 seconds without breaking eye contact. The primary screen is a capture flow with voice recording, photo attach, and a live AI assistant that asks gap-filling questions.
>
> I want a redesign focused on:
> 1. **The capture screen** — calm, one-handed, visually obvious state. Today it's a cluttered vertical stack of 6+ cards. See attached screenshots.
> 2. **The leads list** — currently a plain list, needs filter/search/triage affordances.
> 3. **A minimal design system** — palette, typography scale, icon set, button + input styles I can implement in Tailwind 4.
>
> Constraints:
> - React 19 + Tailwind 4 (no shadcn yet; would be open to adding it)
> - PWA on iOS Safari + Android Chrome
> - Must work offline (visual state for queued/syncing)
> - One-handed thumb operation
> - WCAG 2.1 AA contrast
> - Trade-show energy — confident, fast, not corporate
>
> Please review the attached files (design brief, personas, current screenshots, capture component source), then produce:
> - A revised wireframe of the capture screen in 3 key states (idle, AI-live with match, queued)
> - A revised wireframe of the leads list
> - A color + type + icon system (≤ 12 tokens total)
> - 2–3 sentence rationale per major change
>
> Defer: admin screens, analytics dashboard, sign-in polish, dark mode.

---

## 9. Things the designer should know that aren't visible from the UI alone

- **Audio is always recorded** when the rep records, even if AI assist is off. The raw audio is uploaded with the capture and re-processed server-side post-submit. So even if the AI in the live session glitches, the lead data still gets extracted by the more reliable batch pipeline. This means the UI should not over-stress the "AI is listening" indicator — the AI is a helper, not a gatekeeper.
- **Existing leads get updated, not duplicated**. When a returning visitor comes back to the booth, the AI recognizes them and the capture *adds to* their existing lead. The banner copy reflects this ("Returning lead? / Yes, that's them / Adding to ABC123"). The design should communicate this as a positive, not as an alert.
- **The opportunity code (e.g. ABC123)** is the lead's short identifier and appears in match banners, the lead list, and the CSV. Worth a small typographic treatment — monospace or letter-spaced uppercase — so reps can read it aloud easily.
- **Checklist values are populated only by the AI's tool calls**, never directly from OCR. The design should make it visually obvious that those check marks are the AI's record of what it heard / saw, not the raw badge content.
- **Per-field confidence**: each captured value has a confidence score 0.0–1.0. Currently we render an amber badge for < 0.8 ("needs verify"). Worth designing this more deliberately — confidence is a first-class concept.

---

## 10. Things to ask the user before starting

If the designer wants to make calls that aren't covered here, raise these first:

1. Should we adopt **shadcn/ui** (component primitives library, common with Tailwind) or roll our own? Trade-off: shadcn = faster but a Tailwind/React opinion lock-in.
2. Should we adopt a **proper icon library** (Lucide is the natural fit with shadcn)? Currently emoji.
3. **Dark mode** — yes/no/auto?
4. Should the design system also cover the **admin views** or only rep-facing screens? Admin is utilitarian today; could stay that way.
5. **Brand artifacts** — is there an existing logo, color, font we should respect? Today there is nothing.
