import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { providerConfigs, type ProviderConfig } from '@/db/schema';

export type ConfigKind = ProviderConfig['kind'];

/**
 * Resolve the active provider config for a given (show, kind) — falling back
 * to the per-kind default config if the show has no override. Returns null
 * when no config exists for the kind (no provider configured).
 */
export async function resolveProviderConfig(args: {
  showId: string;
  kind: ConfigKind;
  overrideConfigId?: string | null;
}): Promise<ProviderConfig | null> {
  if (args.overrideConfigId) {
    const [row] = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, args.overrideConfigId))
      .limit(1);
    if (row) return row;
  }

  const [defaultConfig] = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.kind, args.kind), eq(providerConfigs.isDefault, true)))
    .limit(1);
  return defaultConfig ?? null;
}
