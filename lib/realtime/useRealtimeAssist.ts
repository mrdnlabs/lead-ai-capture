'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'closing' | 'closed' | 'error';

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
}

export type LiveFields = Record<string, LiveFieldValue>;

export interface ExistingLeadMatch {
  opportunityCode: string;
  reason: string;
  at: number;
}

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
}

export function useRealtimeAssist() {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [liveFields, setLiveFields] = useState<LiveFields>({});
  const [existingLeadMatches, setExistingLeadMatches] = useState<ExistingLeadMatch[]>([]);
  // Recent-lead snapshot from the token endpoint — keyed by opportunityCode so
  // we can prefill the checklist instantly when the rep confirms a match.
  const existingLeadsRef = useRef<Map<string, Record<string, string>>>(new Map());
  const ctxRef = useRef<RealtimeContext | null>(null);
  const startedRef = useRef(false);

  const stop = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    setStatus('closing');
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
  }, []);

  /**
   * Called when the rep confirms "Yes, expand this lead" on a match banner.
   * Prefills the checklist with whatever we already know about that lead, and
   * nudges the AI mid-session so it stops re-asking for those fields.
   *
   * The prefill uses confidence 0.85 — high enough to render as a captured
   * checkmark, but low enough that anything the AI verifies live (≥0.9) wins.
   */
  const confirmExistingLeadMatch = useCallback((opportunityCode: string) => {
    const known = existingLeadsRef.current.get(opportunityCode);
    if (!known || Object.keys(known).length === 0) return;

    setLiveFields((cur) => {
      const next = { ...cur };
      const now = Date.now();
      for (const [k, v] of Object.entries(known)) {
        if (!v) continue;
        const existing = cur[k];
        // Don't overwrite a higher-confidence value the rep already verified.
        if (existing && (existing.confidence ?? 0) >= 0.85) continue;
        next[k] = { value: v, confidence: 0.85, at: now };
      }
      return next;
    });

    const ctx = ctxRef.current;
    if (ctx?.ws.readyState === WebSocket.OPEN) {
      const lines = Object.entries(known)
        .filter(([, v]) => v)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n');
      ctx.ws.send(
        JSON.stringify({
          realtimeInput: {
            text: `[system] The rep just confirmed this is the same person as opportunity ${opportunityCode}. We already have these fields on file — do NOT re-ask the rep for them:\n${lines}\n\nFocus on NEW info (interest level, next steps, updated title) or any corrections the rep mentions.`,
          },
        }),
      );
    }
  }, []);

  /**
   * Inject an image into the live conversation. Gemini Live treats single
   * images as one-frame video input — same wrapper as audio, different key.
   * The AI can then describe / extract from the image and weave it into the
   * conversation ("I see Sarah Chen, VP Engineering at Acme on the badge…").
   *
   * No-op when the session isn't live, so it's safe to call unconditionally
   * whenever a photo is selected.
   */
  const sendImage = useCallback(async (blob: Blob): Promise<boolean> => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.ws.readyState !== WebSocket.OPEN) return false;
    const buf = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const data = btoa(binary);
    ctx.ws.send(
      JSON.stringify({
        realtimeInput: {
          video: { data, mimeType: blob.type || 'image/jpeg' },
        },
      }),
    );
    // Hint to the model: "the rep just attached a photo — look at it"
    ctx.ws.send(
      JSON.stringify({
        realtimeInput: {
          text: 'The rep just attached a photo — likely the lead\'s name badge or a business card. Take a look and acknowledge or extract what you see.',
        },
      }),
    );
    return true;
  }, []);

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
      const ctx: RealtimeContext = {
        audioCtx,
        ws,
        source,
        ttsDestination,
        mixedStream: mixed.stream,
        responseAudioBuffer,
        responseSampleRate: 24000, // Gemini Live output sample rate
        playbackStartTime: 0,
      };
      ctxRef.current = ctx;

      ws.onopen = () => {
        if (tokenData.setupMessage) {
          ws.send(JSON.stringify(tokenData.setupMessage));
        }
        setStatus('live');
        startMicStreaming(ctx, source, audioCtx, ws);
      };

      ws.onerror = (e) => {
        console.error('[realtime] ws error', e);
        setError('WebSocket error');
        setStatus('error');
      };

      ws.onclose = (e) => {
        if (status !== 'error') setStatus('closed');
        console.log('[realtime] ws closed', e.code, e.reason);
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
          (opportunityCode, reason) => {
            setExistingLeadMatches((cur) => {
              // Don't re-add the same match within a session.
              if (cur.some((f) => f.opportunityCode === opportunityCode)) return cur;
              return [...cur, { opportunityCode, reason, at: Date.now() }];
            });
          },
        );

      // 4. Auto-stop at max duration
      if (args.maxDurationSec) {
        setTimeout(() => {
          if (ctxRef.current === ctx) stop();
        }, args.maxDurationSec * 1000);
      }
    },
    [status, stop],
  );

  return {
    status,
    error,
    transcript,
    requiredFields,
    liveFields,
    existingLeadMatches,
    /** Prefill the checklist from a confirmed match + tell the AI to skip those fields. */
    confirmExistingLeadMatch,
    /** Dismiss a match the rep rejected (so the banner goes away). */
    dismissExistingLeadMatch: (opportunityCode: string) =>
      setExistingLeadMatches((cur) =>
        cur.filter((f) => f.opportunityCode !== opportunityCode),
      ),
    start,
    stop,
    sendImage,
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
  matchExistingLead: (opportunityCode: string, reason: string) => void,
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

  // Gemini Live nests inputTranscription/outputTranscription under serverContent
  if (msg.serverContent?.inputTranscription?.text) {
    pushTranscript({
      role: 'user',
      text: msg.serverContent.inputTranscription.text,
      at: Date.now(),
    });
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
        if (opportunityCode) {
          matchExistingLead(opportunityCode, reason);
          responses.push({
            id: call.id,
            name: call.name,
            response: {
              ok: true,
              note: 'Rep notified — waiting for their confirm.',
            },
          });
        } else {
          responses.push({
            id: call.id,
            name: call.name,
            response: { ok: false, error: 'missing opportunityCode' },
          });
        }
      } else {
        responses.push({
          id: call.id,
          name: call.name,
          response: { ok: false, error: `unknown tool ${call.name}` },
        });
      }
    }
    if (ctx.ws.readyState === WebSocket.OPEN) {
      ctx.ws.send(
        JSON.stringify({ toolResponse: { functionResponses: responses } }),
      );
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
