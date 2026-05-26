import type { ProviderConfig } from '@/db/schema';
import { geminiRealtimeProvider } from './gemini';
import type { RealtimeProvider } from './types';

export function getRealtimeProvider(config: ProviderConfig): RealtimeProvider {
  if (config.kind !== 'realtime') throw new Error(`Not a realtime config: ${config.id}`);
  switch (config.provider) {
    case 'gemini':
      return geminiRealtimeProvider;
    // OpenAI gpt-realtime / WebRTC adapter to add later.
    default:
      throw new Error(`No realtime provider for: ${config.provider}`);
  }
}

export type { RealtimeProvider, RealtimeTokenRequest, RealtimeTokenResult } from './types';
