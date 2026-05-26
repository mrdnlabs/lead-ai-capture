import type { RealtimeProvider, RealtimeTokenRequest, RealtimeTokenResult } from './types';

const GEMINI_AUTH_TOKEN_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1alpha/auth_tokens';
const GEMINI_LIVE_WSS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Gemini Live ephemeral token. For AI Studio keys, the token itself is just
 * a usage-counter + expiry — model + system instructions must be sent by the
 * client in its `setup` WSS message. We return the setup payload alongside
 * the token so the client doesn't have to construct it.
 */
export interface GeminiRealtimeResult extends RealtimeTokenResult {
  provider: 'gemini';
  setupMessage: {
    setup: {
      model: string;
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { responseModalities: string[] };
      inputAudioTranscription: object;
      outputAudioTranscription: object;
    };
  };
}

export const geminiRealtimeProvider: RealtimeProvider = {
  kind: 'realtime',
  async mintEphemeralToken(args: RealtimeTokenRequest): Promise<GeminiRealtimeResult> {
    const model =
      args.model ||
      args.ctx.config.model ||
      'gemini-2.5-flash-preview-native-audio-dialog';
    const apiKey = args.ctx.credential.apiKey;
    const now = Date.now();
    const expireTime = new Date(now + 5 * 60 * 1000).toISOString();

    const res = await fetch(`${GEMINI_AUTH_TOKEN_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uses: 1, expireTime }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini auth_tokens failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as { name?: string };
    if (!json.name) throw new Error('Gemini auth_tokens response missing name');

    return {
      // The token-only path: strip the `auth_tokens/` prefix for the access_token query param.
      token: json.name.replace(/^auth_tokens\//, ''),
      expiresAt: Date.parse(expireTime),
      transport: 'websocket',
      endpoint: GEMINI_LIVE_WSS,
      model,
      provider: 'gemini',
      setupMessage: {
        setup: {
          model: `models/${model}`,
          systemInstruction: { parts: [{ text: args.instructions }] },
          generationConfig: { responseModalities: ['AUDIO'] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
    };
  },
};
