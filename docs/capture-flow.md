# Capture Flow

## Client state machine

```
idle
 └── permissionsRequested
      └── ready
           └── photoCaptured
                └── recording
                     ├── (online) realtimeConnected
                     └── stopping
                          └── localPersisted
                               └── uploading
                                    └── uploaded
                                         └── processed
```

**Invariant**: any failure path transitions to `localPersisted` so nothing is ever lost.

## Codec handling

| Browser | MediaRecorder default | Used by us |
| --- | --- | --- |
| Chrome / Android | `audio/webm;codecs=opus` | Yes |
| Safari / iOS | `audio/mp4;codecs=mp4a.40.2` | Yes |

Detection via `MediaRecorder.isTypeSupported`. Server normalizes both to 16 kHz mono WAV in the first workflow step (`normalizeAudio`).

## Dexie outbox (`lib/db/dexie.ts`)

Two stores: `captures` (current/active) and `outbox` (queued for upload). Blobs stored directly. Quota checked on capture start; warn at >80% used.

## Sync triggers

- **Android Chrome**: `sync.register('capture-upload')`. Service worker drains queue when network returns.
- **iOS Safari**: no Background Sync API. We hook `visibilitychange` + `online` events and surface a visible "X queued — tap to sync" pill for manual flush. Also auto-drain on app focus.

## Audio mixing (online assist)

The single mic stream is **cloned** at acquisition:
1. One clone goes into MediaRecorder (the source of truth recording)
2. The other goes into the WebRTC/WebSocket connection to the realtime provider

The AI's TTS audio comes back as an incoming audio track (WebRTC) or PCM chunks (WebSocket). We:
1. Play it through `<audio>` for the rep to hear
2. Mix it back into the MediaRecorder source via `MediaStreamAudioDestinationNode`

Result: one local file contains rep mic + AI TTS interleaved, suitable for post-hoc transcription by the batch pipeline.
