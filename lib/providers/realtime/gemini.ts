import type { RealtimeProvider, RealtimeTokenRequest, RealtimeTokenResult } from './types';

const GEMINI_LIVE_WSS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Gemini Live realtime connection.
 *
 * SECURITY NOTE: We return the raw API key for direct browser-to-Google WSS
 * connection (`?key=API_KEY`). This is the same pattern the official
 * `@google/genai` SDK uses.
 *
 * The alternative — ephemeral tokens via `v1alpha/auth_tokens` — is supported
 * by Google but **the WSS server rejects them when used from a browser**
 * (close code 1008 "unregistered caller" if ?access_token, or 1007 "API key
 * not valid" if ?key). They appear to be intended only for server-to-server
 * use, not for handing to a browser.
 *
 * Mitigations for the direct-key approach:
 * - Use a dedicated Gemini key with spending limits set in Google AI Studio
 * - Rotate the key periodically
 * - Monitor usage for anomalies
 * - Keep the PWA gated behind Supabase Auth so only verified reps see the key
 */
export interface GeminiRealtimeResult extends RealtimeTokenResult {
  provider: 'gemini';
  authMode: 'direct_api_key';
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
      args.model || args.ctx.config.model || 'gemini-3.1-flash-live-preview';
    const apiKey = args.ctx.credential.apiKey;
    // 30-min "expiry" is informational only — there's no real session limit
    // on the API key itself; this just nudges the client to refresh periodically.
    const expiresAt = Date.now() + 30 * 60 * 1000;

    return {
      token: apiKey,
      expiresAt,
      transport: 'websocket',
      endpoint: GEMINI_LIVE_WSS,
      model,
      provider: 'gemini',
      authMode: 'direct_api_key',
      setupMessage: {
        setup: {
          model: `models/${model}`,
          systemInstruction: { parts: [{ text: args.instructions }] },
          generationConfig: { responseModalities: ['AUDIO'] },
          // Both transcriptions enabled — rep's speech AND AI's speech surface
          // as text (verified working on 2.5-native-audio + 3.1-flash-live).
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
    };
  },
};
