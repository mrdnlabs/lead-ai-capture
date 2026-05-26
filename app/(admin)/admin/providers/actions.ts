'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { providerCredentials, type NewProviderCredential } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';
import { encryptApiKey } from '@/lib/crypto/keyVault';

const PROVIDERS = ['openai', 'gemini', 'google_stt', 'deepgram', 'anthropic'] as const;

const addSchema = z.object({
  provider: z.enum(PROVIDERS),
  label: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(8),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addCredential(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }

  const parsed = addSchema.safeParse({
    provider: formData.get('provider'),
    label: formData.get('label'),
    apiKey: formData.get('apiKey'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const enc = encryptApiKey(parsed.data.apiKey);
  const row: NewProviderCredential = {
    provider: parsed.data.provider,
    label: parsed.data.label,
    encryptedApiKey: enc.ciphertext,
    encryptionKeyId: enc.keyId,
    last4: enc.last4,
    createdByRepId: admin.id,
  };
  await db.insert(providerCredentials).values(row);
  revalidatePath('/admin/providers');
  return { ok: true };
}

export async function setActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }
  await db.update(providerCredentials).set({ isActive }).where(eq(providerCredentials.id, id));
  revalidatePath('/admin/providers');
  return { ok: true };
}

export async function deleteCredential(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }
  try {
    await db.delete(providerCredentials).where(eq(providerCredentials.id, id));
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === '23503') {
      return { ok: false, error: 'In use by a provider config — remove the config first.' };
    }
    return { ok: false, error: err.message };
  }
  revalidatePath('/admin/providers');
  return { ok: true };
}
