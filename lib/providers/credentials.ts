import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { credentialAccessLog, providerCredentials } from '@/db/schema';
import { decryptApiKey } from '@/lib/crypto/keyVault';
import type { DecryptedCredential } from './types';

export interface AccessContext {
  purpose: string;
  contextId?: string | null;
  accessedByRepId?: string | null;
}

export async function loadCredential(
  credentialId: string,
  access: AccessContext,
): Promise<DecryptedCredential> {
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(eq(providerCredentials.id, credentialId))
    .limit(1);
  if (!row) throw new Error(`Credential ${credentialId} not found`);
  if (!row.isActive) throw new Error(`Credential ${credentialId} is disabled`);

  const apiKey = decryptApiKey(row.encryptedApiKey, row.encryptionKeyId);

  // Fire-and-forget audit (failures don't block the call).
  void Promise.all([
    db
      .update(providerCredentials)
      .set({ lastUsedAt: new Date(), useCount: sql`${providerCredentials.useCount} + 1` })
      .where(eq(providerCredentials.id, credentialId))
      .catch(() => {}),
    db
      .insert(credentialAccessLog)
      .values({
        credentialId,
        accessedByRepId: access.accessedByRepId ?? null,
        purpose: access.purpose,
        contextId: access.contextId ?? null,
      })
      .catch(() => {}),
  ]);

  return { id: row.id, provider: row.provider, apiKey };
}
