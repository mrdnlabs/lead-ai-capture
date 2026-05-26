'use server';

import { and, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { providerConfigs, type NewProviderConfig } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';

const KINDS = ['realtime', 'transcription', 'vision', 'extraction'] as const;
const PROVIDERS = ['openai', 'gemini', 'google_stt', 'deepgram', 'anthropic'] as const;

const addSchema = z.object({
  kind: z.enum(KINDS),
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(120),
  credentialId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  defaultInstructions: z.string().trim().max(2000).optional(),
  isDefault: z.coerce.boolean().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ensureAdmin(): Promise<ActionResult | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return { ok: false, error: 'Admin role required' };
  }
}

export async function addConfig(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;

  const parsed = addSchema.safeParse({
    kind: formData.get('kind'),
    provider: formData.get('provider'),
    model: formData.get('model'),
    credentialId: formData.get('credentialId'),
    label: formData.get('label'),
    defaultInstructions: formData.get('defaultInstructions') || undefined,
    isDefault: formData.get('isDefault') === 'on' || formData.get('isDefault') === 'true',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const row: NewProviderConfig = {
    kind: parsed.data.kind,
    provider: parsed.data.provider,
    model: parsed.data.model,
    credentialId: parsed.data.credentialId,
    label: parsed.data.label,
    defaultInstructions: parsed.data.defaultInstructions || null,
    isDefault: parsed.data.isDefault ?? false,
    settings: {},
  };

  await db.transaction(async (tx) => {
    if (row.isDefault) {
      await tx
        .update(providerConfigs)
        .set({ isDefault: false })
        .where(eq(providerConfigs.kind, row.kind));
    }
    await tx.insert(providerConfigs).values(row);
  });

  revalidatePath('/admin/configs');
  return { ok: true };
}

export async function setDefault(id: string): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  const [target] = await db.select().from(providerConfigs).where(eq(providerConfigs.id, id)).limit(1);
  if (!target) return { ok: false, error: 'Config not found' };
  await db.transaction(async (tx) => {
    await tx
      .update(providerConfigs)
      .set({ isDefault: false })
      .where(and(eq(providerConfigs.kind, target.kind), ne(providerConfigs.id, id)));
    await tx.update(providerConfigs).set({ isDefault: true }).where(eq(providerConfigs.id, id));
  });
  revalidatePath('/admin/configs');
  return { ok: true };
}

export async function deleteConfig(id: string): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (guard) return guard;
  try {
    await db.delete(providerConfigs).where(eq(providerConfigs.id, id));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath('/admin/configs');
  return { ok: true };
}
