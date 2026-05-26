import type { ProviderConfig } from '@/db/schema';
import type { DecryptedCredential, ProviderCallContext } from '../types';

export interface RealtimeTokenRequest {
  ctx: ProviderCallContext;
  instructions: string;
  voice?: string;
  maxDurationSec?: number;
  /** Acceptable model override; defaults to the provider config's model. */
  model?: string;
}

export interface RealtimeTokenResult {
  /** Short-lived token the client uses to authenticate with the provider. */
  token: string;
  /** Wall-clock expiry in ms since epoch. */
  expiresAt: number;
  /** Connection transport — informs the client which API to use. */
  transport: 'webrtc' | 'websocket';
  /** Endpoint URL (HTTPS for WebRTC, WSS for WebSocket). */
  endpoint: string;
  /** Model the token is bound to. */
  model: string;
  /** Provider identifier — useful for client-side branching. */
  provider: 'openai' | 'gemini';
}

export interface RealtimeProvider {
  kind: 'realtime';
  mintEphemeralToken(args: RealtimeTokenRequest): Promise<RealtimeTokenResult>;
}

export type { DecryptedCredential, ProviderConfig };
