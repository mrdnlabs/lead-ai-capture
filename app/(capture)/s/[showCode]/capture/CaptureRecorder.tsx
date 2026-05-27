'use client';

import { useEffect, useRef, useState } from 'react';
import { enqueueCapture, uploadOne } from '@/lib/offline/queue';
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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtime = useRealtimeAssist();

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [audioPreviewUrl, photoPreviewUrl]);

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
  }

  async function submit() {
    if (!audioBlob && !photoFile) {
      setError('Add a photo or record audio first.');
      return;
    }
    setState('uploading');
    setError(null);

    const queuedInput = {
      showSlug,
      // Empty opportunityCode tells the server: auto-create a placeholder; AI dedupe later.
      opportunityCode: '',
      clientCapturedAt: new Date().toISOString(),
      durationMs: durationMs > 0 ? durationMs : undefined,
      photoBlob: photoFile ?? undefined,
      audioBlob: audioBlob ?? undefined,
    };

    // If clearly offline, skip the doomed network call and enqueue immediately.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
            ? 'Saved locally. Will upload when you’re back online.'
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
      {/* Photo block */}
      <section className="rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Badge photo</div>
            <div className="text-xs text-neutral-500">Tap to use camera</div>
          </div>
          {photoFile ? (
            <button type="button" onClick={clearPhoto} className="text-xs text-neutral-500 underline">
              clear
            </button>
          ) : null}
        </div>
        {photoPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoPreviewUrl} alt="badge" className="mt-3 max-h-48 rounded-md object-contain" />
        ) : null}
        <label className="mt-3 block">
          <span className="sr-only">Choose photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhotoSelected}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
        </label>
      </section>

      {/* Audio block */}
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

        {realtime.status !== 'idle' && realtime.status !== 'closed' ? (
          <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
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
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={state === 'recording' || state === 'uploading' || (!audioBlob && !photoFile)}
        className="block w-full rounded-md bg-emerald-700 px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === 'uploading' ? 'Uploading…' : 'Submit capture'}
      </button>
    </div>
  );
}
