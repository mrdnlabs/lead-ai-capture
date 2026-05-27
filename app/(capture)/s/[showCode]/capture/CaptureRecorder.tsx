'use client';

import { useEffect, useRef, useState } from 'react';
import { drainQueue, enqueueCapture, uploadOne } from '@/lib/offline/queue';
import { useRealtimeAssist } from '@/lib/realtime/useRealtimeAssist';

type State = 'ready' | 'recording' | 'uploading' | 'done' | 'queued' | 'error';

interface Props {
  showSlug: string;
  leadsUrl: string;
}

function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const mime of [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

export function CaptureRecorder({ showSlug, leadsUrl }: Props) {
  const [state, setState] = useState<State>('ready');
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const [aiAssistEnabled, setAiAssistEnabled] = useState(false);
  // Set when the rep confirms an AI returning-lead match — this capture will
  // attach to the existing opportunity instead of creating a new one.
  const [confirmedExistingLeadCode, setConfirmedExistingLeadCode] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  // Dev toggle — when true, treat the app as offline (force submit through
  // the Dexie queue path even if the browser is actually online).
  const [simulatedOffline, setSimulatedOffline] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const realtime = useRealtimeAssist();

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [audioPreviewUrl, photoPreviewUrl]);

  // Auto-scroll the transcript bubble to the bottom as new chunks arrive so the
  // rep always sees the most recent exchange without manually scrolling.
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [realtime.transcript, realtime.liveFields]);

  // When the simulated-offline toggle flips back to online, drain anything that
  // queued up while it was on. Mirrors the real online-event auto-drain.
  useEffect(() => {
    if (!simulatedOffline) {
      void drainQueue().catch(() => {});
    }
  }, [simulatedOffline]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mime = pickAudioMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        setAudioBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        setDurationMs(Date.now() - startTimeRef.current);
        for (const track of stream.getTracks()) track.stop();
        if (tickerRef.current) clearInterval(tickerRef.current);
        realtime.stop();
        setState('ready');
      };
      rec.start();
      recorderRef.current = rec;
      startTimeRef.current = Date.now();
      setState('recording');
      tickerRef.current = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 200);

      // AI assist runs in parallel: clones the mic track so MediaRecorder + realtime are independent
      if (aiAssistEnabled) {
        const clonedTrack = stream.getAudioTracks()[0]?.clone();
        if (clonedTrack) {
          const realtimeStream = new MediaStream([clonedTrack]);
          void realtime.start({
            showSlug,
            opportunityCode: '',
            micStream: realtimeStream,
            maxDurationSec: 120,
          });
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  // Stop the recorder and resolve with the freshly-built blob. The existing
  // `rec.onstop` handler still runs first (sets state, stops tracks); this
  // listener fires after and gives `submit()` a blob to upload immediately
  // without waiting for a React re-render.
  function stopRecordingAndWait(): Promise<Blob | null> {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => {
      rec.addEventListener(
        'stop',
        () => resolve(new Blob(chunksRef.current, { type: rec.mimeType })),
        { once: true },
      );
      rec.stop();
    });
  }

  function clearAudio() {
    setAudioBlob(null);
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioPreviewUrl(null);
    setDurationMs(0);
    setElapsed(0);
  }

  function clearPhoto() {
    setPhotoFile(null);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
  }

  function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    // If a live session is going, also feed the photo to Gemini so the AI can
    // see it mid-conversation. No-op if not live; the photo is uploaded with
    // the capture regardless.
    void realtime.sendImage(file);
  }

  async function submit() {
    // If we're still recording, the rep is signaling "I'm done" — stop the
    // recorder and grab the final blob inline so they don't have to tap twice.
    let finalAudioBlob = audioBlob;
    let finalDurationMs = durationMs;
    if (state === 'recording') {
      const stopped = await stopRecordingAndWait();
      if (stopped) {
        finalAudioBlob = stopped;
        finalDurationMs = Date.now() - startTimeRef.current;
      }
    }

    if (!finalAudioBlob && !photoFile) {
      setError('Add a photo or record audio first.');
      return;
    }
    setState('uploading');
    setError(null);

    const queuedInput = {
      showSlug,
      // If the rep confirmed a returning-lead match, ride that opportunity code
      // so this capture adds to the existing lead. Otherwise empty → server
      // auto-creates a placeholder and post-hoc AI matching may still re-point.
      opportunityCode: confirmedExistingLeadCode ?? '',
      clientCapturedAt: new Date().toISOString(),
      durationMs: finalDurationMs > 0 ? finalDurationMs : undefined,
      photoBlob: photoFile ?? undefined,
      audioBlob: finalAudioBlob ?? undefined,
      // Preserve the live conversation transcript (rep + AI) so post-processing
      // can extract from it even if audio quality is poor.
      realtimeTranscript: realtime.transcript.length > 0 ? realtime.transcript : undefined,
      // Values the AI captured via set_lead_field tool calls during the live
      // session — high-signal because the rep confirmed each one verbally.
      liveFields:
        Object.keys(realtime.liveFields).length > 0 ? realtime.liveFields : undefined,
    };

    // If offline (real or simulated), skip the doomed network call and enqueue.
    const isOffline =
      simulatedOffline ||
      (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (isOffline) {
      try {
        await enqueueCapture(queuedInput);
        setState('queued');
        return;
      } catch (e) {
        setError(`Could not queue capture: ${(e as Error).message}`);
        setState('error');
        return;
      }
    }

    // Online: try direct upload via the same payload shape uploadOne uses.
    const idempotencyKey = crypto.randomUUID();
    try {
      await uploadOne({
        id: 'inline',
        idempotencyKey,
        queuedAt: Date.now(),
        attempts: 0,
        ...queuedInput,
      });
      setState('done');
    } catch (e) {
      // Network error or 5xx — fall back to the queue so the rep doesn't lose data.
      try {
        await enqueueCapture(queuedInput);
        setState('queued');
      } catch (qe) {
        setError(`Upload failed: ${(e as Error).message}; queue also failed: ${(qe as Error).message}`);
        setState('error');
      }
    }
  }

  function reset() {
    clearAudio();
    clearPhoto();
    setError(null);
    setConfirmedExistingLeadCode(null);
    setState('ready');
  }

  if (state === 'done' || state === 'queued') {
    return (
      <div className="space-y-4">
        <div
          className={
            state === 'queued'
              ? 'rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800'
              : 'rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800'
          }
        >
          {state === 'queued'
            ? simulatedOffline
              ? 'Saved to local queue (simulated offline). Toggle off and the auto-drain will upload it.'
              : 'Saved locally. Will upload when you’re back online.'
            : 'Capture uploaded.'}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
          >
            New capture
          </button>
          <a
            href={leadsUrl}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-center text-sm font-medium"
          >
            View leads
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Capture block — voice + attachments + AI assist all live here */}
      <section className="rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Voice note</div>
            <div className="text-xs text-neutral-500">
              {state === 'recording'
                ? `Recording · ${(elapsed / 1000).toFixed(1)}s`
                : audioBlob
                  ? `Recorded · ${(durationMs / 1000).toFixed(1)}s`
                  : 'Hold the mic to talk about the lead.'}
            </div>
          </div>
          {audioBlob ? (
            <button type="button" onClick={clearAudio} className="text-xs text-neutral-500 underline">
              clear
            </button>
          ) : null}
        </div>
        {audioPreviewUrl ? (
          <audio controls src={audioPreviewUrl} className="mt-3 w-full" />
        ) : null}
        <div className="mt-3">
          {state === 'recording' ? (
            <button
              type="button"
              onClick={stopRecording}
              className="w-full rounded-md bg-red-600 px-3 py-3 text-sm font-medium text-white"
            >
              Stop recording
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={state === 'uploading'}
              className="w-full rounded-md bg-neutral-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {audioBlob ? 'Re-record' : 'Start recording'}
            </button>
          )}
        </div>

        {/* Attachment toolbar — photo + text input. Photo always available;
            text only sends to AI when a live session is active. */}
        <div className="mt-3 space-y-2">
          {photoPreviewUrl ? (
            <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreviewUrl}
                alt="attached"
                className="h-12 w-12 rounded object-cover"
              />
              <div className="flex-1 text-xs text-neutral-600">
                Photo attached
                {realtime.status === 'live' ? (
                  <span className="ml-1 text-emerald-700">· sent to AI</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={clearPhoto}
                className="text-xs text-neutral-500 underline"
              >
                remove
              </button>
            </div>
          ) : null}
          <div className="flex items-stretch gap-2">
            <label
              className="flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
              title="Attach photo (camera or library)"
            >
              <span aria-hidden>📎</span>
              <span className="sr-only">Attach photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={onPhotoSelected}
                className="hidden"
              />
            </label>
            <input
              type="text"
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (realtime.status === 'live' && textDraft.trim()) {
                    realtime.sendText(textDraft);
                    setTextDraft('');
                  }
                }
              }}
              placeholder={
                realtime.status === 'live'
                  ? 'Type a note to the AI (or just talk)…'
                  : 'Enable AI assist to chat by text'
              }
              disabled={realtime.status !== 'live'}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
            />
            <button
              type="button"
              onClick={() => {
                if (realtime.status === 'live' && textDraft.trim()) {
                  realtime.sendText(textDraft);
                  setTextDraft('');
                }
              }}
              disabled={realtime.status !== 'live' || !textDraft.trim()}
              className="rounded-md bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-30"
            >
              Send
            </button>
          </div>
        </div>

        {/* AI assist toggle */}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={aiAssistEnabled}
            onChange={(e) => setAiAssistEnabled(e.target.checked)}
            disabled={state === 'recording'}
            className="mt-0.5 rounded border-neutral-300"
          />
          <span>
            <span className="font-medium text-neutral-900">AI assist (alpha)</span> — Gemini Live
            listens while you talk and asks short gap-filling questions out loud. Your raw recording
            is still saved.
            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              direct API key auth
            </span>
          </span>
        </label>

        {/* Dev toggle — simulate offline mode for testing the Dexie queue. */}
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={simulatedOffline}
            onChange={(e) => setSimulatedOffline(e.target.checked)}
            className="mt-0.5 rounded border-neutral-300"
          />
          <span>
            <span className="font-medium text-neutral-900">Simulate offline</span> — submit goes
            to the local queue instead of the network. Useful for testing the offline outbox.
            {simulatedOffline ? (
              <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                OFFLINE MODE
              </span>
            ) : null}
          </span>
        </label>

        {realtime.status !== 'idle' && realtime.status !== 'closed' ? (
          <div className="mt-3 space-y-2">
            {/* Returning-lead match banner(s) — rep confirms or dismisses. */}
            {realtime.existingLeadMatches.map((match) => {
              const isConfirmed = confirmedExistingLeadCode === match.opportunityCode;
              return (
                <div
                  key={match.opportunityCode}
                  className={
                    'rounded-md border p-2 text-xs ' +
                    (isConfirmed
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-sky-300 bg-sky-50')
                  }
                >
                  <div className="font-medium text-neutral-900">
                    {isConfirmed
                      ? `Adding to ${match.opportunityCode}`
                      : `Returning lead? ${match.opportunityCode}`}
                  </div>
                  <div className="mt-0.5 text-neutral-700">{match.reason}</div>
                  {!isConfirmed ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmedExistingLeadCode(match.opportunityCode)}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
                      >
                        Yes, that's them
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          realtime.rollbackExistingLeadPrefill(match.opportunityCode);
                          realtime.dismissExistingLeadMatch(match.opportunityCode);
                        }}
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700"
                      >
                        No, different person
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmedExistingLeadCode(null);
                        realtime.rollbackExistingLeadPrefill(match.opportunityCode);
                        realtime.dismissExistingLeadMatch(match.opportunityCode);
                      }}
                      className="mt-2 text-xs text-neutral-500 underline"
                    >
                      undo
                    </button>
                  )}
                </div>
              );
            })}

            {/* Live checklist — fills in as the AI calls set_lead_field. */}
            {realtime.requiredFields.length > 0 ? (
              <div className="rounded-md border border-neutral-200 bg-white p-2 text-xs">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
                  Checklist
                </div>
                <ul className="space-y-1">
                  {realtime.requiredFields.map((f) => {
                    const captured = realtime.liveFields[f.key];
                    const done = captured && captured.value;
                    const lowConf =
                      captured?.confidence != null && captured.confidence < 0.8;
                    return (
                      <li key={f.key} className="flex items-start gap-2">
                        <span
                          className={
                            'mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ' +
                            (done
                              ? lowConf
                                ? 'border-amber-500 bg-amber-100 text-amber-700'
                                : 'border-green-600 bg-green-600 text-white'
                              : f.required
                                ? 'border-neutral-400 text-neutral-400'
                                : 'border-neutral-200 text-neutral-300')
                          }
                          aria-hidden
                        >
                          {done ? '✓' : f.required ? '★' : ''}
                        </span>
                        <span className="flex-1">
                          <span className="text-neutral-700">{f.label}</span>
                          {done ? (
                            <span className="ml-1 font-medium text-neutral-900">
                              · {captured.value}
                            </span>
                          ) : null}
                          {lowConf && captured?.confidence != null ? (
                            <span className="ml-1 text-[10px] text-amber-700">
                              ({Math.round(captured.confidence * 100)}% — needs verify)
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {/* Live transcript bubble */}
            <div
              ref={transcriptScrollRef}
              className="max-h-44 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs"
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-500">
                <span
                  className={
                    'inline-block h-1.5 w-1.5 rounded-full ' +
                    (realtime.status === 'live'
                      ? 'animate-pulse bg-green-500'
                      : realtime.status === 'error'
                        ? 'bg-red-500'
                        : realtime.status === 'connecting'
                          ? 'animate-pulse bg-amber-500'
                          : 'bg-neutral-300')
                  }
                />
                AI {realtime.status}
              </div>
              {realtime.error ? (
                <div className="mt-1 rounded bg-red-50 p-2 text-red-700">{realtime.error}</div>
              ) : null}
              {realtime.transcript.length === 0 ? (
                <div className="mt-1 text-neutral-400">
                  {realtime.status === 'connecting' ? 'Connecting to Gemini…' : 'Listening…'}
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {realtime.transcript.map((t, i) => (
                    <div key={i} className={t.role === 'assistant' ? 'text-blue-700' : 'text-neutral-700'}>
                      <span className="font-medium">{t.role === 'assistant' ? 'AI' : 'You'}:</span> {t.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={state === 'uploading' || (state !== 'recording' && !audioBlob && !photoFile)}
        className="block w-full rounded-md bg-emerald-700 px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === 'uploading'
          ? 'Uploading…'
          : state === 'recording'
            ? 'Stop & submit'
            : 'Submit capture'}
      </button>
    </div>
  );
}
