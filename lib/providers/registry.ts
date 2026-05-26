import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { providerAbAssignments, providerConfigs, type ProviderConfig } from '@/db/schema';

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

/**
 * Find the "shadow" provider config for an A/B comparison, if any. Returns
 * the other config in the A/B assignment for this (show, kind), or null.
 * Used by the orchestrator to run a parallel extraction without overriding
 * the merged lead fields.
 */
export async function resolveShadowProviderConfig(args: {
  showId: string;
  kind: ConfigKind;
  primaryConfigId: string;
}): Promise<ProviderConfig | null> {
  const [assignment] = await db
    .select()
    .from(providerAbAssignments)
    .where(
      and(
        eq(providerAbAssignments.showId, args.showId),
        eq(providerAbAssignments.kind, args.kind),
      ),
    )
    .limit(1);
  if (!assignment) return null;
  const otherId =
    assignment.providerConfigAId === args.primaryConfigId
      ? assignment.providerConfigBId
      : assignment.providerConfigAId;
  if (!otherId || otherId === args.primaryConfigId) return null;
  const [other] = await db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.id, otherId))
    .limit(1);
  return other ?? null;
}

// re-export to keep imports tidy
export { or };
