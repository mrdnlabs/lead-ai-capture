import type { ConfigKind } from './registry';
import { resolveProviderConfig } from './registry';
import { loadCredential } from './credentials';
import { tryFallbackProvider, type ResolvedProvider } from './fallback';

/**
 * One-stop helper: get a usable {config, credential} pair for a (show, kind).
 *
 * Resolution order:
 *   1. Show's override config (shows.transcriptionProviderConfigId etc.)
 *   2. Default config for this kind in provider_configs
 *   3. Server-side env fallback (DEFAULT_GEMINI_API_KEY) — if set
 *
 * Returns null only when no config exists AND no env fallback is configured.
 */
export async function resolveProviderForKind(args: {
  showId: string;
  kind: ConfigKind;
  overrideConfigId?: string | null;
  purpose: string;
  contextId?: string | null;
  accessedByRepId?: string | null;
}): Promise<ResolvedProvider | null> {
  const userConfig = await resolveProviderConfig({
    showId: args.showId,
    kind: args.kind,
    overrideConfigId: args.overrideConfigId,
  });
  if (userConfig) {
    const credential = await loadCredential(userConfig.credentialId, {
      purpose: args.purpose,
      contextId: args.contextId ?? null,
      accessedByRepId: args.accessedByRepId ?? null,
    });
    return { config: userConfig, credential, isFallback: false };
  }
  return tryFallbackProvider(args.kind);
}
