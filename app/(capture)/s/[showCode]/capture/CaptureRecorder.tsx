'use client';

import { useEffect, useRef, useState } from 'react';

type State = 'ready' | 'recording' | 'uploading' | 'done' | 'error';

interface Props {
  showSlug: string;
  opportunityCode: string;
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

export function CaptureRecorder({ showSlug, opportunityCode, leadsUrl }: Props) {
  const [state, setState] = useState<State>('ready');
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setState('ready');
      };
      rec.start();
      recorderRef.current = rec;
      startTimeRef.current = Date.now();
      setState('recording');
      tickerRef.current = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 200);
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
    const form = new FormData();
    form.set('showSlug', showSlug);
    form.set('opportunityCode', opportunityCode);
    form.set('idempotencyKey', crypto.randomUUID());
    form.set('clientCapturedAt', new Date().toISOString());
    if (durationMs > 0) form.set('durationMs', String(durationMs));
    if (audioBlob) {
      const ext = audioBlob.type.includes('webm') ? 'webm' : audioBlob.type.includes('mp4') ? 'm4a' : 'audio';
      form.set('audio', new File([audioBlob], `capture.${ext}`, { type: audioBlob.type }));
    }
    if (photoFile) form.set('photo', photoFile);

    const res = await fetch('/api/captures', { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(body.error ?? `HTTP ${res.status}`);
      setState('error');
      return;
    }
    setState('done');
  }

  function reset() {
    clearAudio();
    clearPhoto();
    setError(null);
    setState('ready');
  }

  if (state === 'done') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Capture uploaded.
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
