'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Image as ImageIcon,
  Send,
  Sparkles,
  User,
  X,
  Check,
} from 'lucide-react';
import { drainQueue, enqueueCapture, uploadOne } from '@/lib/offline/queue';
import { useRealtimeAssist } from '@/lib/realtime/useRealtimeAssist';
import { showToast } from '@/lib/ui/toast';
import { DevPanel } from '@/components/dev/DevPanel';
import { QueuePill } from '@/components/ui/QueuePill';
import { ShowSwatch } from '@/components/ui/ShowSwatch';
import { ShowSwitcherSheet, type Show, type ShowSummary } from '@/components/show/ShowSwitcherSheet';
import { LeadPickerSheet, type PickedLead } from '@/components/sheets/LeadPickerSheet';
import { QueueSheet } from '@/components/sheets/QueueSheet';
import { subscribeQueueChanges, queueCount } from '@/lib/offline/queue';

type State = 'ready' | 'recording' | 'uploading' | 'error';
type ActiveSheet = null | 'switch' | 'pick' | 'queue';

interface Props {
  showSlug: string;
  show: Show;
  shows: ShowSummary[];
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

export function CaptureRecorder({ showSlug, show, shows, leadsUrl }: Props) {
  const searchParams = useSearchParams();
  const devMode = searchParams.get('dev') === '1';

  const [state, setState] = useState<State>('ready');
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  /** Set when AI flagged a match OR rep picked from LeadPickerSheet — the
   *  next submit attaches to this opportunity instead of creating one. */
  const [targetLead, setTargetLead] = useState<{ code: string; name: string } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);

  // Queue + sync indicators for the header pill.
  const [queueLen, setQueueLen] = useState(0);
  const [syncing, setSyncing] = useState(0);
  useEffect(() => {
    void queueCount().then(setQueueLen);
    return subscribeQueueChanges(() => {
      void queueCount().then(setQueueLen);
    });
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const realtime = useRealtimeAssist();

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [realtime.transcript, realtime.liveFields]);

  useEffect(() => {
    if (!simulatedOffline) void drainQueue().catch(() => {});
  }, [simulatedOffline]);

  // AI flagged a match → auto-set as targetLead (one-tap "Yes" replaced).
  // The match-banner shows with a "not them" button so the rep can roll back.
  const lastSeenMatchRef = useRef<number | null>(null);
  useEffect(() => {
    const latest = realtime.existingLeadMatches[realtime.existingLeadMatches.length - 1];
    if (!latest) return;
    if (lastSeenMatchRef.current === latest.at) return;
    lastSeenMatchRef.current = latest.at;
    if (!targetLead) {
      setTargetLead({
        code: latest.opportunityCode,
        name: latest.name ?? latest.opportunityCode,
      });
    }
  }, [realtime.existingLeadMatches, targetLead]);

  // AI calls end_conversation → auto-submit.
  const endHandledRef = useRef<number | null>(null);
  useEffect(() => {
    const req = realtime.endRequested;
    if (!req || endHandledRef.current === req.at) return;
    endHandledRef.current = req.at;
    if (state === 'ready' || state === 'recording') void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtime.endRequested, state]);

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
        setDurationMs(Date.now() - startTimeRef.current);
        for (const track of stream.getTracks()) track.stop();
        if (tickerRef.current) clearInterval(tickerRef.current);
        realtime.stop();
        setState('ready');
      };
      rec.start();
      recorderRef.current = rec;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setState('recording');
      tickerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)),
        500,
      );

      if (aiAssistEnabled) {
        const clonedTrack = stream.getAudioTracks()[0]?.clone();
        if (clonedTrack) {
          void realtime.start({
            showSlug,
            opportunityCode: targetLead?.code ?? '',
            micStream: new MediaStream([clonedTrack]),
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

  function discardRecording() {
    if (!window.confirm('Discard this recording? Audio, transcript, and any captured fields will be lost.')) {
      return;
    }
    const rec = recorderRef.current;
    chunksRef.current = [];
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    }
    if (tickerRef.current) clearInterval(tickerRef.current);
    realtime.stop();
    setAudioBlob(null);
    setDurationMs(0);
    setElapsed(0);
    setTextDraft('');
    setTargetLead(null);
    setError(null);
    setState('ready');
  }

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

  function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    void realtime.sendImage(file, showSlug);
  }

  /** Reset to a fresh `ready` for the next capture — used after submit. */
  function resetForNext() {
    setAudioBlob(null);
    setPhotoFile(null);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
    setDurationMs(0);
    setElapsed(0);
    setTextDraft('');
    setTargetLead(null);
    setError(null);
    setState('ready');
  }

  async function submit() {
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
      opportunityCode: targetLead?.code ?? '',
      clientCapturedAt: new Date().toISOString(),
      durationMs: finalDurationMs > 0 ? finalDurationMs : undefined,
      photoBlob: photoFile ?? undefined,
      audioBlob: finalAudioBlob ?? undefined,
      realtimeTranscript: realtime.transcript.length > 0 ? realtime.transcript : undefined,
      liveFields:
        Object.keys(realtime.liveFields).length > 0 ? realtime.liveFields : undefined,
    };

    const wasTargeted = !!targetLead;
    const wasOffline =
      simulatedOffline ||
      (typeof navigator !== 'undefined' && navigator.onLine === false);

    // Snapshot for the toast, then immediately reset so the rep can start the
    // next capture. The upload continues in the background.
    resetForNext();

    if (wasOffline) {
      try {
        await enqueueCapture(queuedInput);
        showToast({
          kind: 'offline',
          title: 'Saved offline',
          meta: 'Will sync when you reconnect.',
          action: { label: 'View queue', onClick: () => setActiveSheet('queue') },
        });
      } catch (e) {
        showToast({ kind: 'offline', title: 'Could not save', meta: (e as Error).message });
      }
      return;
    }

    setSyncing((n) => n + 1);
    try {
      await uploadOne({
        id: 'inline',
        idempotencyKey: crypto.randomUUID(),
        queuedAt: Date.now(),
        attempts: 0,
        ...queuedInput,
      });
      showToast(
        wasTargeted
          ? { kind: 'accent', title: 'Updated existing lead', meta: targetLead?.code }
          : { kind: 'ok', title: 'Lead saved', meta: 'AI is extracting in the background.' },
      );
    } catch (e) {
      try {
        await enqueueCapture(queuedInput);
        showToast({
          kind: 'offline',
          title: 'Saved offline',
          meta: 'Upload retried — will sync when you reconnect.',
          action: { label: 'View queue', onClick: () => setActiveSheet('queue') },
        });
      } catch {
        showToast({ kind: 'offline', title: 'Capture failed', meta: (e as Error).message });
      }
    } finally {
      setSyncing((n) => Math.max(0, n - 1));
    }
  }

  // Format elapsed seconds as MM:SS
  const mmss = useMemo(() => {
    const e = state === 'recording' ? elapsed : 0;
    return `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
  }, [elapsed, state]);

  return (
    <div className="scr">
      {/* ────── top bar ────── */}
      <div className="scr-top">
        {state === 'recording' ? (
          <div className="t-eyebrow whitespace-nowrap">{show.name}</div>
        ) : (
          <button
            type="button"
            className="show-pill"
            onClick={() => setActiveSheet('switch')}
            aria-label="Switch show"
          >
            <ShowSwatch slug={show.slug} name={show.name} size="xs" />
            <span className="nm">{show.name}</span>
            <ChevronRight size={14} className="text-ink-4 rotate-90" />
          </button>
        )}

        <div className="row gap-2">
          {state === 'recording' ? (
            <span className="pill pill-live">
              <span className="dot" aria-hidden />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss}</span>
            </span>
          ) : (
            <QueuePill
              count={queueLen}
              syncing={syncing}
              onClick={() => setActiveSheet('queue')}
            />
          )}
        </div>
      </div>

      {/* ────── body ────── */}
      <div className="scr-body">
        {state === 'recording' ? (
          <LiveBody
            transcript={realtime.transcript}
            liveFields={realtime.liveFields}
            requiredFields={realtime.requiredFields}
            existingMatch={
              targetLead
                ? { code: targetLead.code, name: targetLead.name }
                : null
            }
            onClearMatch={() => {
              if (targetLead) {
                realtime.rollbackExistingLeadPrefill(targetLead.code);
                realtime.dismissExistingLeadMatch(targetLead.code);
              }
              setTargetLead(null);
            }}
            transcriptScrollRef={transcriptScrollRef}
            photoPreviewUrl={photoPreviewUrl}
            imageStatus={realtime.imageExtractStatus}
            aiActive={
              realtime.status === 'live' ||
              realtime.status === 'connecting' ||
              realtime.status === 'closing'
            }
          />
        ) : (
          <ReadyBody
            targetLead={targetLead}
            onClearTarget={() => setTargetLead(null)}
            photoPreviewUrl={photoPreviewUrl}
            onPhotoSelected={onPhotoSelected}
            cameraInputRef={cameraInputRef}
            libraryInputRef={libraryInputRef}
            aiAssistEnabled={aiAssistEnabled}
            setAiAssistEnabled={setAiAssistEnabled}
            onPickLead={() => setActiveSheet('pick')}
            error={error}
            leadsUrl={leadsUrl}
          />
        )}
      </div>

      {/* ────── foot ────── */}
      <div className="scr-foot">
        {state === 'recording' ? (
          <>
            <div className="row gap-2 mb-2.5">
              <label className="icon-btn cursor-pointer" title="Take photo">
                <Camera size={18} />
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhotoSelected}
                  className="hidden"
                />
              </label>
              <label className="icon-btn cursor-pointer" title="Browse photos">
                <ImageIcon size={18} />
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPhotoSelected}
                  className="hidden"
                />
              </label>
              {realtime.status === 'live' ? (
                <div className="search-input" style={{ flex: 1, height: 44 }}>
                  <input
                    type="text"
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && textDraft.trim()) {
                        e.preventDefault();
                        realtime.sendText(textDraft);
                        setTextDraft('');
                      }
                    }}
                    placeholder="Type a note to the AI…"
                  />
                  <button
                    type="button"
                    className="text-ink"
                    onClick={() => {
                      if (textDraft.trim()) {
                        realtime.sendText(textDraft);
                        setTextDraft('');
                      }
                    }}
                    disabled={!textDraft.trim()}
                    aria-label="Send"
                  >
                    <Send size={16} className="disabled:opacity-30" />
                  </button>
                </div>
              ) : (
                <div className="t-tiny flex-1 self-center text-ink-4">
                  Recording · tap Stop &amp; save when done.
                </div>
              )}
            </div>
            <button type="button" className="cap-btn is-recording" onClick={submit}>
              <span className="cap-ring" aria-hidden />
              Stop &amp; save
            </button>
            <button
              type="button"
              onClick={discardRecording}
              className="mt-2 text-xs text-ink-4 hover:text-ink-3 mx-auto block underline"
            >
              Discard recording
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="cap-btn"
              onClick={startRecording}
              disabled={state === 'uploading'}
            >
              <span className="cap-ring" aria-hidden />
              {targetLead ? `Tap to add to ${targetLead.code}` : 'Tap to capture'}
            </button>
            <div className="t-tiny mt-3 text-center text-ink-4">
              Audio always saved · offline-ready
              <span className="op-code ml-2 text-[9px] text-ink-5">
                build {process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ────── sheets ────── */}
      <ShowSwitcherSheet
        open={activeSheet === 'switch'}
        onClose={() => setActiveSheet(null)}
        currentSlug={show.slug}
        shows={shows}
      />
      <LeadPickerSheet
        open={activeSheet === 'pick'}
        onClose={() => setActiveSheet(null)}
        showSlug={show.slug}
        onPick={(lead: PickedLead) => {
          setTargetLead({ code: lead.opportunityCode, name: lead.name ?? lead.opportunityCode });
          setActiveSheet(null);
        }}
      />
      <QueueSheet open={activeSheet === 'queue'} onClose={() => setActiveSheet(null)} />

      {devMode ? (
        <DevPanel
          simulatedOffline={simulatedOffline}
          setSimulatedOffline={setSimulatedOffline}
        />
      ) : null}
    </div>
  );
}

// ────── Ready body ──────

function ReadyBody({
  targetLead,
  onClearTarget,
  photoPreviewUrl,
  onPhotoSelected,
  cameraInputRef,
  libraryInputRef,
  aiAssistEnabled,
  setAiAssistEnabled,
  onPickLead,
  error,
  leadsUrl,
}: {
  targetLead: { code: string; name: string } | null;
  onClearTarget: () => void;
  photoPreviewUrl: string | null;
  onPhotoSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  aiAssistEnabled: boolean;
  setAiAssistEnabled: (v: boolean) => void;
  onPickLead: () => void;
  error: string | null;
  leadsUrl: string;
}) {
  return (
    <>
      <div>
        <div className="t-eyebrow">New capture</div>
        <h1 className="t-title" style={{ marginTop: 6 }}>
          {targetLead ? `Adding to ${targetLead.name}` : 'Ready when you are.'}
        </h1>
      </div>

      {targetLead ? (
        <div className="target-chip mt-4">
          <div className="w-9 h-9 rounded-[10px] bg-white/20 flex items-center justify-center flex-shrink-0">
            <User size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="row gap-2 items-baseline">
              <span className="lbl">Updating</span>
              <span className="code-on-accent">{targetLead.code}</span>
            </div>
            <div className="nm whitespace-nowrap overflow-hidden text-ellipsis mt-0.5">
              {targetLead.name}
            </div>
          </div>
          <button type="button" className="close" onClick={onClearTarget} aria-label="Clear target">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Hidden file inputs — sit outside the card so they don't interfere
          with the row's flex layout. Buttons trigger them via ref.click(). */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPhotoSelected}
        className="hidden"
        aria-hidden
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        onChange={onPhotoSelected}
        className="hidden"
        aria-hidden
      />

      <div className="card mt-4" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="photo-thumb" style={{ borderRadius: 0, border: 'none' }}>
          {photoPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreviewUrl}
              alt="badge"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            'BADGE PHOTO — TAP CAMERA'
          )}
        </div>
        <div
          style={{
            display: 'flex',
            padding: 12,
            gap: 8,
            alignItems: 'stretch',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            style={{
              flex: '1 1 0',
              height: 44,
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              border: '1px solid var(--rule-2)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              font: 'inherit',
              padding: '0 12px',
            }}
          >
            <Camera size={18} />
            <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 500 }}>Camera</span>
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            style={{
              flex: '1 1 0',
              height: 44,
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              border: '1px solid var(--rule-2)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              font: 'inherit',
              padding: '0 12px',
            }}
          >
            <ImageIcon size={18} />
            <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 500 }}>Library</span>
          </button>
        </div>
      </div>

      <button
        type="button"
        className="card mt-3 flex gap-3 items-center cursor-pointer text-left w-full"
        style={{ borderColor: aiAssistEnabled ? 'var(--ink)' : 'var(--rule)' }}
        onClick={() => setAiAssistEnabled(!aiAssistEnabled)}
      >
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
          style={{
            background: aiAssistEnabled ? 'var(--ink)' : 'var(--paper-2)',
            color: aiAssistEnabled ? 'var(--paper)' : 'var(--ink-3)',
          }}
        >
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">AI assist</div>
          <div className="t-tiny mt-1">Asks short gap-filling questions while you talk.</div>
        </div>
        <Toggle on={aiAssistEnabled} />
      </button>

      {!targetLead ? (
        <button
          type="button"
          className="card-flat mt-3 flex items-center gap-3 text-left w-full border-0"
          onClick={onPickLead}
        >
          <div className="w-9 h-9 rounded-[10px] bg-paper-3 text-ink-2 flex items-center justify-center flex-shrink-0">
            <User size={18} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">Continue with an existing lead</div>
            <div className="t-tiny mt-1">Skip the match — pick a lead to add this capture to.</div>
          </div>
          <ChevronRight size={16} className="text-ink-4" />
        </button>
      ) : null}

      <div className="spacer" />

      {error ? (
        <div className="mt-4 rounded-[var(--r-3)] border border-warn bg-warn-wash px-3 py-2 text-sm text-warn">
          {error}
        </div>
      ) : null}

      <a
        href={leadsUrl}
        className="mt-6 t-meta self-center hover:text-ink-2 underline-offset-2 hover:underline"
      >
        <ArrowLeft size={12} className="inline -mt-px mr-1" />
        See captured leads
      </a>
    </>
  );
}

// ────── Live body ──────

function LiveBody({
  transcript,
  liveFields,
  requiredFields,
  existingMatch,
  onClearMatch,
  transcriptScrollRef,
  photoPreviewUrl,
  imageStatus,
  aiActive,
}: {
  transcript: ReturnType<typeof useRealtimeAssist>['transcript'];
  liveFields: ReturnType<typeof useRealtimeAssist>['liveFields'];
  requiredFields: ReturnType<typeof useRealtimeAssist>['requiredFields'];
  existingMatch: { code: string; name: string } | null;
  onClearMatch: () => void;
  transcriptScrollRef: React.RefObject<HTMLDivElement | null>;
  photoPreviewUrl: string | null;
  imageStatus: ReturnType<typeof useRealtimeAssist>['imageExtractStatus'];
  /** True when an AI assist WSS session is connecting / live. Drives whether
   *  the AI cards (reading status, checklist, transcript) render. */
  aiActive: boolean;
}) {
  const captured = requiredFields.filter((f) => liveFields[f.key]?.value).length;
  const total = requiredFields.length || 1;
  const progress = Math.min(100, Math.round((captured / total) * 100));

  return (
    <>
      {existingMatch ? (
        <div className="match-banner">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-accent text-accent-ink flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="label">Returning lead</div>
            <div className="who whitespace-nowrap overflow-hidden text-ellipsis">
              {existingMatch.name} <span className="code ml-1.5">{existingMatch.code}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearMatch}
            className="flex-shrink-0 h-7 px-2.5 rounded-md text-xs font-medium whitespace-nowrap border border-rule-2 bg-surface text-ink-2"
          >
            not them
          </button>
        </div>
      ) : null}

      {/* Photo thumb (always — even without AI we want the rep to see what
          they attached). Status pill switches between AI / silent. */}
      <div className="card mt-3 p-3 flex gap-3 items-center">
        <div className="photo-thumb photo-thumb-sm flex-shrink-0">
          {photoPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreviewUrl}
              alt="badge"
              className="absolute inset-0 w-full h-full object-cover rounded-[12px]"
            />
          ) : (
            'BADGE'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="row gap-1.5">
            {aiActive ? (
              <span className="pill pill-ai">
                <Sparkles size={12} />
                {imageStatus === 'extracting' ? 'Reading badge…' : 'AI reading'}
              </span>
            ) : (
              <span className="pill">Recording</span>
            )}
          </div>
          {aiActive ? (
            <>
              <div className="t-meta mt-2 text-ink-2">
                {captured} of {total} fields captured
              </div>
              <div className="h-1 bg-paper-3 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-ink rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          ) : (
            <div className="t-tiny mt-2">
              AI assist is off. Audio + photo will be extracted to fields after you save.
            </div>
          )}
        </div>
      </div>

      {/* Checklist + transcript only when an AI session is active — without
          it these are empty boxes that confuse the rep. */}
      {aiActive ? (
        <>
          <div className="card mt-3">
            <div className="t-eyebrow mb-2.5">Captured</div>
            <div className="check-list">
              {requiredFields.map((f) => {
                const captured = liveFields[f.key];
                const isDone = captured && captured.value;
                const lowConf =
                  captured?.confidence != null && captured.confidence < 0.8;
                return (
                  <div
                    key={f.key}
                    className={`check-row ${isDone ? (lowConf ? 'is-warn' : 'is-done') : ''}`}
                  >
                    <div className="ck">
                      {isDone ? <Check size={12} strokeWidth={2.5} /> : null}
                    </div>
                    <span className="label">{f.label}</span>
                    {isDone ? <span className="value">{captured.value}</span> : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div ref={transcriptScrollRef} className="tx-bubble mt-3 max-h-44 overflow-y-auto">
            <div className="t-eyebrow text-live">Transcript</div>
            {transcript.length === 0 ? (
              <div className="t-tiny">Listening…</div>
            ) : (
              transcript.map((t, i) => (
                <div
                  key={i}
                  className={`tx-line ${t.role === 'assistant' ? 'is-ai' : 'is-rep'}`}
                >
                  <span className="who">{t.role === 'assistant' ? 'AI' : 'You'}</span>
                  <span className="text">{t.text}</span>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}

      <div className="spacer min-h-2" />
    </>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <div
      className="w-[38px] h-[22px] rounded-[11px] relative transition-colors flex-shrink-0"
      style={{ background: on ? 'var(--ink)' : 'var(--paper-3)' }}
      aria-hidden
    >
      <div
        className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-surface shadow transition-[left] duration-200"
        style={{ left: on ? 18 : 2 }}
      />
    </div>
  );
}
