import type { ProviderConfig } from '@/db/schema';
import type { DecryptedCredential } from './types';

/**
 * Server-side fallback providers — used when the admin hasn't configured a
 * credential for a given provider. Lets the app work out-of-the-box for the
 * common case (you ship the app, the rep just signs in and captures) without
 * an admin having to set up keys first.
 *
 * Each fallback maps a kind to a (provider, model, env var) combo. If the
 * env var isn't set, that kind has no fallback and the caller must skip it.
 */

interface FallbackSpec {
  provider: ProviderConfig['provider'];
  model: string;
  envVar: string;
}

const FALLBACKS: Partial<Record<ProviderConfig['kind'], FallbackSpec>> = {
  transcription: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    envVar: 'DEFAULT_GEMINI_API_KEY',
  },
  vision: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    envVar: 'DEFAULT_GEMINI_API_KEY',
  },
  extraction: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    envVar: 'DEFAULT_GEMINI_API_KEY',
  },
  realtime: {
    provider: 'gemini',
    model: 'gemini-2.5-flash-native-audio-latest',
    envVar: 'DEFAULT_GEMINI_API_KEY',
  },
};

const SENTINEL_CREDENTIAL_ID = '__env_fallback__';

export interface ResolvedProvider {
  config: ProviderConfig;
  credential: DecryptedCredential;
  isFallback: boolean;
}

export function tryFallbackProvider(kind: ProviderConfig['kind']): ResolvedProvider | null {
  const spec = FALLBACKS[kind];
  if (!spec) return null;
  const apiKey = process.env[spec.envVar];
  if (!apiKey) return null;
  const config: ProviderConfig = {
    id: `fallback:${kind}`,
    kind,
    provider: spec.provider,
    model: spec.model,
    credentialId: SENTINEL_CREDENTIAL_ID,
    label: '(server default)',
    defaultInstructions: null,
    settings: {},
    isDefault: false,
    createdAt: new Date(),
  };
  const credential: DecryptedCredential = {
    id: SENTINEL_CREDENTIAL_ID,
    provider: spec.provider,
    apiKey,
  };
  return { config, credential, isFallback: true };
}

/**
 * Lists which fallback providers are available right now. Useful for admin UI.
 */
export function listAvailableFallbacks(): Array<{ kind: ProviderConfig['kind']; provider: string; model: string }> {
  const out: Array<{ kind: ProviderConfig['kind']; provider: string; model: string }> = [];
  for (const [kind, spec] of Object.entries(FALLBACKS) as Array<[ProviderConfig['kind'], FallbackSpec]>) {
    if (process.env[spec.envVar]) {
      out.push({ kind, provider: spec.provider, model: spec.model });
    }
  }
  return out;
}
