'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { customFieldDefinitions, leadForms, shows } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';
import { inferLeadFormFromCsv, type InferredField } from '@/lib/leadForm/infer';

const customFieldTypeEnum = z.enum(['text', 'select', 'multiselect', 'boolean', 'number']);

const fieldSchema = z.object({
  csvHeader: z.string().min(1),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: customFieldTypeEnum,
  options: z.array(z.string()).optional(),
  required: z.coerce.boolean(),
  aiExtractionHint: z.string().optional(),
});

export type FieldDef = z.infer<typeof fieldSchema>;

export type InferResult =
  | { ok: true; fields: InferredField[] }
  | { ok: false; error: string };

export async function inferAction(showId: string, sampleCsv: string): Promise<InferResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }
  if (!sampleCsv.trim()) return { ok: false, error: 'Paste a CSV sample first.' };
  if (sampleCsv.length > 20_000) {
    return { ok: false, error: 'CSV sample is too large (keep under 20 KB).' };
  }
  try {
    const inferred = await inferLeadFormFromCsv(sampleCsv);
    return { ok: true, fields: inferred.fields };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveAction(
  showId: string,
  formName: string,
  sampleCsv: string,
  fields: FieldDef[],
): Promise<SaveResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }
  if (!formName.trim()) return { ok: false, error: 'Form name is required.' };
  const parsedFields = z.array(fieldSchema).safeParse(fields);
  if (!parsedFields.success) {
    return {
      ok: false,
      error: 'One or more fields are invalid: ' + parsedFields.error.issues.map((i) => i.message).join('; '),
    };
  }

  await db.transaction(async (tx) => {
    const [show] = await tx.select().from(shows).where(eq(shows.id, showId)).limit(1);
    if (!show) throw new Error('Show not found');

    let leadFormId = show.leadFormId;
    if (leadFormId) {
      await tx
        .update(leadForms)
        .set({
          name: formName,
          sourceSampleCsv: sampleCsv,
          icaptureHeaders: parsedFields.data.map((f) => f.csvHeader),
        })
        .where(eq(leadForms.id, leadFormId));
      await tx
        .delete(customFieldDefinitions)
        .where(eq(customFieldDefinitions.leadFormId, leadFormId));
    } else {
      const [created] = await tx
        .insert(leadForms)
        .values({
          showId,
          name: formName,
          sourceSampleCsv: sampleCsv,
          icaptureHeaders: parsedFields.data.map((f) => f.csvHeader),
        })
        .returning();
      leadFormId = created.id;
      await tx.update(shows).set({ leadFormId }).where(eq(shows.id, showId));
    }

    for (let i = 0; i < parsedFields.data.length; i++) {
      const f = parsedFields.data[i];
      await tx.insert(customFieldDefinitions).values({
        leadFormId,
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        required: f.required,
        aiExtractionHint: f.aiExtractionHint ?? null,
        csvHeader: f.csvHeader,
        ordering: i,
      });
    }
  });

  revalidatePath(`/admin/shows/${showId}/lead-form`);
  revalidatePath('/admin/shows');
  return { ok: true };
}
