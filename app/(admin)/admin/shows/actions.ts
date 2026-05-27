'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { shows, showReps } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits, hyphens only'),
});

export type CreateShowResult = { ok: true; slug: string } | { ok: false; error: string };

export async function createShow(
  _prev: CreateShowResult | null,
  formData: FormData,
): Promise<CreateShowResult> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, error: 'Admin role required' };
  }

  const parsed = schema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  try {
    const [created] = await db
      .insert(shows)
      .values({
        name: parsed.data.name,
        slug: parsed.data.slug,
        startsAt: new Date(),
        createdBy: admin.id,
      })
      .returning();
    // Auto-add the creator as a rep on the new show
    await db
      .insert(showReps)
      .values({ showId: created.id, repId: admin.id, role: 'admin' })
      .onConflictDoNothing();
    revalidatePath('/admin/shows');
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === '23505') {
      return { ok: false, error: `Slug "${parsed.data.slug}" is taken — pick another.` };
    }
    return { ok: false, error: err.message };
  }

  redirect(`/admin/shows/${parsed.data.slug}/lead-form`);
}
