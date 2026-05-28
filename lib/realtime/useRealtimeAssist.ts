'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { logDebug } from '@/lib/debug/log';

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'closing' | 'closed' | 'error';

export type ImageExtractStatus = 'idle' | 'extracting' | 'done' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface RequiredField {
  key: string;
  label: string;
  required: boolean;
}

export interface LiveFieldValue {
  value: string;
  confidence?: number;
  at: number;
  /**
   * 'prefill' = filled from an existing lead's known fields when the AI flagged
   *   a match. Lower trust — rolled back if the rep rejects the match.
   * 'live'    = captured this session via set_lead_field. Treated as ground truth.
   */
  source?: 'prefill' | 'live';
}

export type LiveFields = Record<string, LiveFieldValue>;

export interface ExistingLeadMatch {
  opportunityCode: string;
  reason: string;
  at: number;
  /** Display name derived from the lead's known fields (if available). */
  name?: string;
  /** AI's confidence the match is correct, 0.0–1.0. >= 0.9 = auto-prefill;
   *  below that, the UI asks the rep to confirm before any prefill. */
  confidence: number;
  /** True if we've already applied the prefill (auto on high conf, or after
   *  rep tapped Yes). UI uses this to decide which banner mode to render. */
  prefillApplied: boolean;
}

/** Below this threshold, the rep is asked to confirm before any prefill. */
const AUTO_PREFILL_THRESHOLD = 0.9;

interface TokenResponse {
  token: string;
  expiresAt: number;
  transport: 'webrtc' | 'websocket';
  endpoint: string;
  model: string;
  provider: 'gemini' | 'openai';
  providerConfigId: string;
  /** Present for Gemini Live — sent as first WSS message to configure session. */
  setupMessage?: unknown;
  /** Fields the AI is expected to collect (drives the checklist UI). */
  requiredFields?: RequiredField[];
  /** Known fields per recent lead — used to prefill the checklist on match-confirm. */
  existingLeads?: Array<{ opportunityCode: string; knownFields: Record<string, string> }>;
}

interface StartArgs {
  showSlug: string;
  opportunityCode: string;
  /**
   * Audio source from MediaRecorder — we'll clone its mic track and pipe AI
   * TTS output back into a MediaStreamAudioDestinationNode so the local
   * recording captures both sides of the conversation.
   */
  micStream: MediaStream;
  maxDurationSec?: number;
  onTranscript?: (entry: TranscriptEntry) => void;
  /** A new MediaStream containing rep mic + AI TTS, for the MediaRecorder. */
  onMixedStreamReady?: (stream: MediaStream) => void;
}

// Gemini Live wants 16 kHz mono PCM s16le. Helper to convert Float32 frames.
function float32ToPcm16Base64(float32: Float32Array): string {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return new Int16Array(buf);
}

interface RealtimeContext {
  audioCtx: AudioContext;
  ws: WebSocket;
  processor?: ScriptProcessorNode | AudioWorkletNode;
  source?: MediaStreamAudioSourceNode;
  ttsDestination: MediaStreamAudioDestinationNode;
  mixedStream: MediaStream;
  responseAudioBuffer: Int16Array[];
  responseSampleRate: number;
  playbackStartTime: number;
  /** Per-session ID — groups debug log entries for a single conversation. */
  sessionId: string;
}

/** Send a JSON message and tee a (summarized) copy into the debug log. */
function wsSendLogged(
  ctx: Pick<RealtimeContext, 'ws' | 'sessionId'>,
  kind: string,
  payload: unknown,
): void {
  ctx.ws.send(JSON.stringify(payload));
  logDebug(ctx.sessionId, 'send', kind, payload);
}

export function useRealtimeAssist() {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [liveFields, setLiveFields] = useState<LiveFields>({});
  const [existingLeadMatches, setExistingLeadMatches] = useState<ExistingLeadMatch[]>([]);
  const [imageExtractStatus, setImageExtractStatus] = useState<ImageExtractStatus>('idle');
  // Set when the AI calls end_conversation — CaptureRecorder observes this
  // and triggers its own submit() flow.
  const [endRequested, setEndRequested] = useState<{ reason: string; at: number } | null>(null);
  // Recent-lead snapshot from the token endpoint — keyed by opportunityCode so
  // we can prefill the checklist instantly when the AI flags a match.
  const existingLeadsRef = useRef<Map<string, Record<string, string>>>(new Map());
  // Tracks which liveField keys were prefilled from which opportunity — used to
  // roll back precisely if the rep taps "No, different person".
  const prefillOriginRef = useRef<Map<string, Set<string>>>(new Map());
  const ctxRef = useRef<RealtimeContext | null>(null);
  const startedRef = useRef(false);
  // Inactivity timer — fires stop() after the rep is quiet for this long.
  // Reset on every detected rep activity (typed text, transcribed mic input,
  // photo attach). Not reset by AI output alone — the AI talking to itself
  // shouldn't extend the session.
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT_MS = 30_000;

  const cancelInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelInactivityTimer();
    const ctx = ctxRef.current;
    if (!ctx) return;
    setStatus('closing');
    logDebug(ctx.sessionId, 'event', 'session_stop', { reason: 'client-stop' });
    try {
      ctx.processor?.disconnect();
      ctx.source?.disconnect();
      ctx.ws.close(1000, 'client-stop');
      void ctx.audioCtx.close();
    } catch {
      /* ignore */
    }
    ctxRef.current = null;
    startedRef.current = false;
    setStatus('closed');
  }, [cancelInactivityTimer]);

  const resetInactivityTimer = useCallback(() => {
    cancelInactivityTimer();
    inactivityTimerRef.current = setTimeout(() => {
      const ctx = ctxRef.current;
      if (ctx) {
        logDebug(ctx.sessionId, 'event', 'session_inactivity_timeout', {
          afterMs: INACTIVITY_TIMEOUT_MS,
        });
      }
      stop();
    }, INACTIVITY_TIMEOUT_MS);
  }, [cancelInactivityTimer, stop]);

  /**
   * Fired when the AI calls match_existing_lead. Prefills the checklist with
   * whatever's on file for that lead AND tells the AI to stop re-asking those
   * fields. This is optimistic — the rep can still reject via the banner, in
   * which case we roll back to restore the prior checklist state.
   *
   * Prefill confidence is 0.85: high enough to render as a green checkmark,
   * low enough that any in-session voice-verified value (≥0.9) wins.
   */
  const applyExistingLeadPrefill = useCallback((opportunityCode: string) => {
    const known = existingLeadsRef.current.get(opportunityCode);
    if (!known || Object.keys(known).length === 0) return;

    const appliedKeys = new Set<string>();
    setLiveFields((cur) => {
      const next = { ...cur };
      const now = Date.now();
      for (const [k, v] of Object.entries(known)) {
        if (!v) continue;
        const existing = cur[k];
        // Don't overwrite a higher-confidence value the rep already verified.
        if (existing && (existing.confidence ?? 0) >= 0.85) continue;
        next[k] = { value: v, confidence: 0.85, at: now, source: 'prefill' };
        appliedKeys.add(k);
      }
      return next;
    });
    if (appliedKeys.size > 0) {
      prefillOriginRef.current.set(opportunityCode, appliedKeys);
    }

    const ctx = ctxRef.current;
    if (ctx?.ws.readyState === WebSocket.OPEN) {
      const lines = Object.entries(known)
        .filter(([, v]) => v)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n');
      wsSendLogged(ctx, 'system_prefill_note', {
        realtimeInput: {
          text: `[system] You just flagged this as a match for opportunity ${opportunityCode}. We already have these fields on file — do NOT re-ask the rep for them:\n${lines}\n\nFocus on NEW info (interest level, next steps, updated title) or any corrections the rep mentions.`,
        },
      });
    }
  }, []);

  /**
   * Roll back the prefill for an opportunity — removes only the keys that
   * came from this opportunity's prefill AND haven't been overwritten by a
   * live capture since (source !== 'prefill' means rep + AI confirmed it).
   *
   * Also pushes a [system] note to the live AI telling it to exclude this
   * opportunity from future match suggestions, so it can flag a different
   * candidate from the EXISTING LEADS list (or proceed as a new lead).
   */
  const rollbackExistingLeadPrefill = useCallback((opportunityCode: string) => {
    const keys = prefillOriginRef.current.get(opportunityCode);
    if (keys && keys.size > 0) {
      setLiveFields((cur) => {
        const next = { ...cur };
        for (const k of keys) {
          const entry = next[k];
          if (entry && entry.source === 'prefill') delete next[k];
        }
        return next;
      });
      prefillOriginRef.current.delete(opportunityCode);
    }

    const ctx = ctxRef.current;
    if (ctx?.ws.readyState === WebSocket.OPEN) {
      wsSendLogged(ctx, 'system_rejection_note', {
        realtimeInput: {
          text: `[system] The rep rejected your match suggestion for opportunity ${opportunityCode} — that is NOT the right lead. Do not suggest it again. Re-check the EXISTING LEADS list for a better match based on what the rep has actually said. If nothing else fits, proceed as a brand-new lead and just help capture their info.`,
        },
      });
    }
  }, []);

  /**
   * Send a typed message into the live conversation. Same wire format as
   * voice, just text — the AI will reply in voice (and the response shows
   * up in the transcript bubble like everything else).
   *
   * We also echo the typed text into the local transcript as a "user" turn
   * so the rep sees what they sent and post-processing has it.
   */
  const sendText = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const ctx = ctxRef.current;
    if (!ctx || ctx.ws.readyState !== WebSocket.OPEN) return false;
    wsSendLogged(ctx, 'user_text', { realtimeInput: { text: trimmed } });
    setTranscript((cur) => [...cur, { role: 'user', text: trimmed, at: Date.now() }]);
    resetInactivityTimer();
    return true;
  }, [resetInactivityTimer]);

  /**
   * Inject an image into the live conversation by running it through the
   * server's structured vision pipeline FIRST, then posting the extracted
   * fields to the WSS as a [system] note. The AI never sees raw bytes
   * during the live call — only clean structured facts — which fixes a
   * hallucination problem with Gemini Live's in-conversation image reading.
   *
   * Nothing is auto-populated into the checklist. The AI decides which
   * values to commit via set_lead_field, and whether to call
   * match_existing_lead — same control plane as text-only conversations.
   *
   * The raw photo still uploads via /api/captures on Submit (unchanged) —
   * this endpoint does not persist anything.
   *
   * No-op when the session isn't live, so it's safe to call unconditionally
   * whenever a photo is selected.
   */
  const sendImage = useCallback(async (blob: Blob, showSlug: string): Promise<boolean> => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.ws.readyState !== WebSocket.OPEN) return false;

    resetInactivityTimer();
    setImageExtractStatus('extracting');
    let fields: Record<string, unknown> | null = null;
    let errorMsg: string | null = null;
    try {
      const fd = new FormData();
      fd.set('showSlug', showSlug);
      fd.set('photo', blob, 'photo.' + (blob.type.includes('png') ? 'png' : 'jpg'));
      const res = await fetch('/api/realtime/vision-extract', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        errorMsg = body.error ?? `HTTP ${res.status}`;
      } else {
        const body = (await res.json()) as { fields: Record<string, unknown> };
        fields = body.fields;
      }
    } catch (e) {
      errorMsg = (e as Error).message;
    }

    if (fields) {
      logDebug(ctx.sessionId, 'event', 'vision_extract_result', fields);
      // Build a compact, scannable representation. We strip null/empty so the
      // AI doesn't see "name: null" and treat it as a known-empty fact.
      const compact: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
        compact[k] = v;
      }
      const visible = Object.keys(compact).length > 0
        ? JSON.stringify(compact, null, 2)
        : '(vision returned no readable fields)';

      wsSendLogged(ctx, 'photo_vision_result', {
        realtimeInput: {
          text:
            '[system] The rep just attached a photo of a badge or business card. ' +
            'A structured vision pass extracted these fields from the printed text:\n' +
            visible +
            '\n\n' +
            'These are facts from the printed card — high confidence on identity fields. Now:\n' +
            '1. Compare against EXISTING LEADS. If this matches one, call match_existing_lead.\n' +
            '2. Call set_lead_field for each value you want committed to the checklist (this is the ONLY way values land on the checklist — nothing is auto-populated from the OCR).\n' +
            "3. Ask the rep about anything the card doesn't cover (interest level, decision-making role, next steps, etc.).",
        },
      });
      setImageExtractStatus('done');
    } else {
      logDebug(ctx.sessionId, 'event', 'vision_extract_failed', { error: errorMsg });
      wsSendLogged(ctx, 'photo_vision_failed', {
        realtimeInput: {
          text:
            '[system] The rep attached a photo but the server-side vision extraction failed (' +
            (errorMsg ?? 'unknown error') +
            '). Ask the rep to describe what is on the card so you can capture it manually.',
        },
      });
      setImageExtractStatus('error');
    }
    return fields !== null;
  }, [resetInactivityTimer]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const start = useCallback(
    async (args: StartArgs) => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStatus('connecting');
      setError(null);
      setTranscript([]);
      setLiveFields({});
      setExistingLeadMatches([]);
      setImageExtractStatus('idle');
      setEndRequested(null);

      // 1. Mint token from our server
      const tokenRes = await fetch('/api/realtime/token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showSlug: args.showSlug,
          opportunityCode: args.opportunityCode,
          maxDurationSec: args.maxDurationSec,
        }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: `HTTP ${tokenRes.status}` }));
        setError(body.error ?? `HTTP ${tokenRes.status}`);
        setStatus('error');
        startedRef.current = false;
        return;
      }
      const tokenData = (await tokenRes.json()) as TokenResponse;
      if (tokenData.requiredFields) setRequiredFields(tokenData.requiredFields);
      if (tokenData.existingLeads) {
        existingLeadsRef.current = new Map(
          tokenData.existingLeads.map((l) => [l.opportunityCode, l.knownFields]),
        );
      }

      // 2. Set up audio plumbing
      const audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioCtx.createMediaStreamSource(args.micStream);
      // Destination for AI TTS output — both played to user AND mixed into MediaRecorder source
      const ttsDestination = audioCtx.createMediaStreamDestination();
      const mixed = audioCtx.createMediaStreamDestination();

      // Mix mic + AI into one stream for the MediaRecorder
      source.connect(mixed);
      const ttsToMixed = audioCtx.createMediaStreamSource(ttsDestination.stream);
      ttsToMixed.connect(mixed);

      // Inform caller about the mixed stream (they'll feed it to MediaRecorder)
      args.onMixedStreamReady?.(mixed.stream);

      // 3. Open WebSocket. Auth param depends on provider:
      //   Gemini → ?key=API_KEY (direct API key — ephemeral tokens don't work browser-side)
      //   OpenAI → ?access_token=ek_... (when we add OpenAI Realtime later)
      const authParam = tokenData.provider === 'gemini' ? 'key' : 'access_token';
      const url = `${tokenData.endpoint}?${authParam}=${encodeURIComponent(tokenData.token)}`;
      const ws = new WebSocket(url);
      // Gemini sends server messages as binary (JSON-encoded UTF-8 bytes).
      ws.binaryType = 'arraybuffer';

      const responseAudioBuffer: Int16Array[] = [];
      const sessionId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ctx: RealtimeContext = {
        audioCtx,
        ws,
        source,
        ttsDestination,
        mixedStream: mixed.stream,
        responseAudioBuffer,
        responseSampleRate: 24000, // Gemini Live output sample rate
        playbackStartTime: 0,
        sessionId,
      };
      ctxRef.current = ctx;
      logDebug(sessionId, 'event', 'session_start', {
        showSlug: args.showSlug,
        provider: tokenData.provider,
        model: tokenData.model,
        endpoint: tokenData.endpoint,
      });

      ws.onopen = () => {
        if (tokenData.setupMessage) {
          wsSendLogged(ctx, 'setup', tokenData.setupMessage);
        }
        setStatus('live');
        startMicStreaming(ctx, source, audioCtx, ws);
        logDebug(sessionId, 'event', 'ws_open', { readyState: ws.readyState });
        resetInactivityTimer();
      };

      ws.onerror = (e) => {
        console.error('[realtime] ws error', e);
        setError('WebSocket error');
        setStatus('error');
        logDebug(sessionId, 'event', 'ws_error', { type: (e as Event).type });
      };

      ws.onclose = (e) => {
        if (status !== 'error') setStatus('closed');
        console.log('[realtime] ws closed', e.code, e.reason);
        logDebug(sessionId, 'event', 'ws_close', { code: e.code, reason: e.reason });
      };

      ws.onmessage = (e) =>
        handleServerMessage(
          e,
          ctx,
          audioCtx,
          (entry) => {
            // Coalesce consecutive same-role chunks into one turn so the bubble
            // shows "AI: full sentence" instead of one bubble per streamed word.
            setTranscript((cur) => {
              const last = cur[cur.length - 1];
              if (last && last.role === entry.role) {
                const merged: TranscriptEntry = {
                  role: entry.role,
                  text: last.text + entry.text,
                  at: last.at,
                };
                return [...cur.slice(0, -1), merged];
              }
              return [...cur, entry];
            });
            args.onTranscript?.(entry);
          },
          (key, value, confidence) => {
            setLiveFields((cur) => ({
              ...cur,
              [key]: { value, confidence, at: Date.now() },
            }));
          },
          (opportunityCode, reason, confidence) => {
            const known = existingLeadsRef.current.get(opportunityCode);
            const name =
              known?.name ||
              [known?.first_name, known?.last_name].filter(Boolean).join(' ') ||
              undefined;
            const autoApply = confidence >= AUTO_PREFILL_THRESHOLD;
            setExistingLeadMatches((cur) => {
              // Don't re-add the same match within a session.
              if (cur.some((f) => f.opportunityCode === opportunityCode)) return cur;
              return [
                ...cur,
                {
                  opportunityCode,
                  reason,
                  at: Date.now(),
                  name,
                  confidence,
                  prefillApplied: autoApply,
                },
              ];
            });
            if (autoApply) {
              // High-confidence match → prefill immediately; rep can roll back.
              applyExistingLeadPrefill(opportunityCode);
            }
            // Low-confidence: banner shows with Yes/No; nothing prefills until rep taps Yes.
          },
          (reason) => {
            setEndRequested({ reason, at: Date.now() });
          },
          resetInactivityTimer,
        );

      // 4. Auto-stop at max duration
      if (args.maxDurationSec) {
        setTimeout(() => {
          if (ctxRef.current === ctx) stop();
        }, args.maxDurationSec * 1000);
      }
    },
    [status, stop, applyExistingLeadPrefill, resetInactivityTimer],
  );

  return {
    status,
    error,
    transcript,
    requiredFields,
    liveFields,
    existingLeadMatches,
    /** Roll back the optimistic prefill (rep rejected the AI's match). */
    rollbackExistingLeadPrefill,
    /** Apply prefill on a previously-tentative match (rep tapped Yes). */
    confirmExistingLeadPrefill: (opportunityCode: string) => {
      applyExistingLeadPrefill(opportunityCode);
      setExistingLeadMatches((cur) =>
        cur.map((m) =>
          m.opportunityCode === opportunityCode ? { ...m, prefillApplied: true } : m,
        ),
      );
    },
    /** Dismiss a match (so the banner goes away). */
    dismissExistingLeadMatch: (opportunityCode: string) =>
      setExistingLeadMatches((cur) =>
        cur.filter((f) => f.opportunityCode !== opportunityCode),
      ),
    start,
    stop,
    sendImage,
    sendText,
    imageExtractStatus,
    /** Non-null when the AI called end_conversation. Watch this from the UI
     *  to auto-submit + close. */
    endRequested,
  };
}

function startMicStreaming(
  ctx: RealtimeContext,
  source: MediaStreamAudioSourceNode,
  audioCtx: AudioContext,
  ws: WebSocket,
) {
  // ScriptProcessorNode is deprecated but the simplest cross-browser path.
  // For prod, swap to an AudioWorkletNode.
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  ctx.processor = processor;
  // Sample mic chunks into the debug log so they're visible but don't blow up
  // storage: log every Nth chunk with a size summary, not the audio bytes.
  let micChunkCount = 0;
  processor.onaudioprocess = (event) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const b64 = float32ToPcm16Base64(input);
    // New Gemini Live wire format (replaces deprecated realtimeInput.mediaChunks)
    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: b64,
          },
        },
      }),
    );
    micChunkCount++;
    if (micChunkCount % 20 === 1) {
      logDebug(ctx.sessionId, 'send', 'mic_audio_chunk', {
        chunkIndex: micChunkCount,
        approxBytes: b64.length,
        sample: 'every-20th-chunk-logged',
      });
    }
  };
  source.connect(processor);
  // ScriptProcessorNode needs a sink to actually process
  processor.connect(audioCtx.destination);
}

interface ServerContent {
  modelTurn?: {
    parts?: Array<{
      inlineData?: { mimeType: string; data: string };
      text?: string;
    }>;
  };
  inputTranscription?: InputTranscription;
  outputTranscription?: InputTranscription;
  turnComplete?: boolean;
  interrupted?: boolean;
}

interface InputTranscription {
  text: string;
  finished?: boolean;
}

interface ToolCallMessage {
  functionCalls?: Array<{
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  }>;
}

function messageToText(data: MessageEvent['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return null;
}

function handleServerMessage(
  e: MessageEvent,
  ctx: RealtimeContext,
  audioCtx: AudioContext,
  pushTranscript: (entry: TranscriptEntry) => void,
  setField: (key: string, value: string, confidence?: number) => void,
  matchExistingLead: (opportunityCode: string, reason: string, confidence: number) => void,
  endConversation: (reason: string) => void,
  onRepActivity: () => void,
) {
  const text = messageToText(e.data);
  if (!text) return;
  let msg: {
    serverContent?: ServerContent;
    setupComplete?: object;
    toolCall?: ToolCallMessage;
  };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }

  // Classify the message so the debug log has a useful "kind" column.
  let kind = 'unknown';
  if (msg.setupComplete) kind = 'setupComplete';
  else if (msg.toolCall) kind = 'toolCall';
  else if (msg.serverContent?.modelTurn) kind = 'modelTurn';
  else if (msg.serverContent?.inputTranscription) kind = 'inputTranscription';
  else if (msg.serverContent?.outputTranscription) kind = 'outputTranscription';
  else if (msg.serverContent?.turnComplete) kind = 'turnComplete';
  else if (msg.serverContent?.interrupted) kind = 'interrupted';
  logDebug(ctx.sessionId, 'recv', kind, msg);

  // Gemini Live nests inputTranscription/outputTranscription under serverContent
  if (msg.serverContent?.inputTranscription?.text) {
    pushTranscript({
      role: 'user',
      text: msg.serverContent.inputTranscription.text,
      at: Date.now(),
    });
    // Rep speaking counts as activity — reset the inactivity timer.
    onRepActivity();
  }
  if (msg.serverContent?.outputTranscription?.text) {
    pushTranscript({
      role: 'assistant',
      text: msg.serverContent.outputTranscription.text,
      at: Date.now(),
    });
  }

  const parts = msg.serverContent?.modelTurn?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data && part.inlineData.mimeType.startsWith('audio/')) {
      // Decode the PCM chunk and schedule it on the TTS destination
      const pcm = base64ToInt16(part.inlineData.data);
      schedulePcmPlayback(pcm, ctx, audioCtx);
    }
    if (part.text) {
      pushTranscript({ role: 'assistant', text: part.text, at: Date.now() });
    }
  }

  // Function calls from the model — update the checklist + acknowledge so the
  // model knows the value landed. Gemini wants a toolResponse per call id.
  if (msg.toolCall?.functionCalls && msg.toolCall.functionCalls.length > 0) {
    const responses: Array<{ id?: string; name: string; response: unknown }> = [];
    for (const call of msg.toolCall.functionCalls) {
      const args = call.args ?? {};
      if (call.name === 'set_lead_field') {
        const key = typeof args.key === 'string' ? args.key : null;
        const value = args.value == null ? '' : String(args.value);
        const confidence =
          typeof args.confidence === 'number' ? args.confidence : undefined;
        if (key) {
          setField(key, value, confidence);
          responses.push({
            id: call.id,
            name: call.name,
            response: { ok: true, key },
          });
        } else {
          responses.push({
            id: call.id,
            name: call.name,
            response: { ok: false, error: 'missing key' },
          });
        }
      } else if (call.name === 'match_existing_lead') {
        const opportunityCode =
          typeof args.opportunityCode === 'string' ? args.opportunityCode : null;
        const reason = typeof args.reason === 'string' ? args.reason : '';
        // Confidence defaults to 0.7 (tentative) if the AI didn't supply one
        // — we want the rep to confirm in that case rather than auto-fill.
        const confidence =
          typeof args.confidence === 'number'
            ? Math.max(0, Math.min(1, args.confidence))
            : 0.7;
        // Defensive: the AI sometimes calls this with a "no match" reason
        // (the enum forces a code but the reasoning negates the call). Drop
        // those so the rep doesn't see a contradictory banner.
        const reasonSaysNoMatch = /\bno\b.*\b(match|existing|candidate)\b|doesn['’]?t match|don['’]?t match|not the same|new lead/i.test(
          reason,
        );
        if (opportunityCode && !reasonSaysNoMatch) {
          matchExistingLead(opportunityCode, reason, confidence);
          responses.push({
            id: call.id,
            name: call.name,
            response: {
              ok: true,
              autoApplied: confidence >= 0.9,
              note:
                confidence >= 0.9
                  ? 'High confidence — checklist auto-filled. Rep can tap "not them" to roll back.'
                  : 'Lower confidence — rep is being asked to confirm before any prefill.',
            },
          });
        } else if (reasonSaysNoMatch) {
          responses.push({
            id: call.id,
            name: call.name,
            response: {
              ok: false,
              error:
                'Your reason indicates no actual match. Do not call match_existing_lead unless a candidate truly fits — proceed as a new lead instead.',
            },
          });
        } else {
          responses.push({
            id: call.id,
            name: call.name,
            response: { ok: false, error: 'missing opportunityCode' },
          });
        }
      } else if (call.name === 'end_conversation') {
        const reason = typeof args.reason === 'string' ? args.reason : 'rep indicated done';
        endConversation(reason);
        responses.push({
          id: call.id,
          name: call.name,
          response: { ok: true, note: 'Session closing — capture will be submitted.' },
        });
      } else {
        responses.push({
          id: call.id,
          name: call.name,
          response: { ok: false, error: `unknown tool ${call.name}` },
        });
      }
    }
    if (ctx.ws.readyState === WebSocket.OPEN) {
      wsSendLogged(ctx, 'tool_response', {
        toolResponse: { functionResponses: responses },
      });
    }
  }
}

function schedulePcmPlayback(pcm: Int16Array, ctx: RealtimeContext, audioCtx: AudioContext) {
  const sampleRate = ctx.responseSampleRate;
  const buffer = audioCtx.createBuffer(1, pcm.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

  const sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.connect(ctx.ttsDestination);
  // Also play to the user's speakers
  sourceNode.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  const startAt = Math.max(now, ctx.playbackStartTime);
  sourceNode.start(startAt);
  ctx.playbackStartTime = startAt + buffer.duration;
}
