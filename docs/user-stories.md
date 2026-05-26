# User Stories

Format: Given / When / Then.

## Capture (Riley)

**US-1 — Quick offline capture**
- Given Riley is at the booth with no Wi-Fi
- When they tap "New capture," snap a badge photo, hold-to-record 20 seconds describing the lead, and tap stop
- Then the photo + audio are stored in IndexedDB and a "1 queued" pill appears in the header

**US-2 — AI-assisted capture (online)**
- Given Riley is online and has AI assist enabled
- When they start a capture and start talking
- Then the AI hears them and asks short follow-up questions only for fields not yet mentioned ("What was their email?")
- And the recorded audio file contains both Riley's narration AND the AI's questions AND Riley's answers

**US-3 — Auto-sync on reconnect**
- Given there are queued captures from earlier offline activity
- When Wi-Fi reconnects and Riley returns to the app
- Then queued captures upload automatically (Android) or upload after one tap on the pill (iOS)

## Multi-phone (Riley + Sam)

**US-4 — Joining a shared opportunity**
- Given Sam has created an opportunity with code "K7Q3M" via QR
- When Riley scans the QR on their phone
- Then their next capture is tagged to the same opportunity and merges into the same lead record

## Display (Sam)

**US-5 — Mid-show lead browser**
- Given the show is in progress
- When Sam opens the display route on a tablet
- Then they see every lead captured so far, with missing-field chips and confidence indicators, updated within ~5 seconds of any new capture

## Admin (Alex)

**US-6 — Add a provider key**
- Given Alex has an OpenAI API key
- When they paste it into `/admin/providers` and save
- Then it is encrypted at rest, only the last 4 characters are displayed, and the network never sends the full key back to the browser

**US-7 — A/B providers**
- Given Alex wants to compare Gemini vs OpenAI transcription for a specific show
- When they configure an A/B split at 50/50 in the admin UI
- Then both providers run on each capture in shadow mode and the analytics page shows side-by-side cost, latency, and transcript diffs

## iCapture export (Pat)

**US-8 — Post-show CSV export**
- Given Sam ends the show and clicks Export CSV
- When Pat downloads the file and uploads it into iCapture's Lead Upload Tool
- Then iCapture accepts the file and maps every column to the correct lead form field with no manual remapping
