'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'closing' | 'closed' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
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

      ws.onmessage = (e) => handleServerMessage(e, ctx, audioCtx, (entry) => {
        setTranscript((cur) => [...cur, entry]);
        args.onTranscript?.(entry);
      });

      // 4. Auto-stop at max duration
      if (args.maxDurationSec) {
        setTimeout(() => {
          if (ctxRef.current === ctx) stop();
        }, args.maxDurationSec * 1000);
      }
    },
    [status, stop],
  );

  return { status, error, transcript, start, stop };
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
    ws.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: 'audio/pcm;rate=16000',
              data: b64,
            },
          ],
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
) {
  const text = messageToText(e.data);
  if (!text) return;
  let msg: {
    serverContent?: ServerContent;
    setupComplete?: object;
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
