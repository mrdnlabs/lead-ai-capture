# Goals

## Why this exists

The company uses **iCapture** (Cvent-owned) for trade-show lead capture. The iCapture mobile app:

- Crashes frequently during shows
- Requires connectivity (poor experience in convention halls)
- Forces awkward form-fill UX during live conversations with prospects
- Reps end up filling things in later from memory anyway

We want an **AI-native PWA** that lets reps capture leads naturally via voice + a quick badge photo, with the AI handling structure extraction, and then exports back to iCapture for the existing downstream processes.

## Success metrics

- **Capture speed**: < 10 seconds of rep attention per lead (vs ~60 seconds in iCapture)
- **Reliability**: zero data loss across connectivity outages and app crashes
- **Field completeness**: ≥ 80% of required iCapture fields populated automatically by AI, with the rest surfaced as a short follow-up list
- **iCapture compatibility**: generated CSV imports into iCapture's Lead Upload Tool without manual cleanup
- **End-to-end testable** by an AI coding agent (Playwright fixtures + mocked providers)

## Non-goals (v1)

- Replacing iCapture's admin/reporting UI
- Real-time CRM sync (Salesforce, HubSpot, etc.)
- Native iOS / Android apps
- On-device AI (we always process server-side)
- Real-time CRDT collaboration between phones (we use simpler server-side reconciliation via shared opportunity codes)
