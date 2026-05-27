'use server';

import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { showInvites, showReps } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';

function generateToken(): string {
  // 24 random bytes → 32 url-safe base64 chars (no padding).
  return randomBytes(24).toString('base64url');
}

export async function mintInviteAction(formData: FormData) {
  const rep = await requireRep();
  const showId = String(formData.get('showId') ?? '');
  const role = String(formData.get('role') ?? 'rep');
  const days = Number(formData.get('days') ?? 14);
  const maxUses = Number(formData.get('maxUses') ?? 50);

  if (!showId) throw new Error('showId required');
  if (role !== 'rep' && role !== 'lead') throw new Error('invalid role');

  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.insert(showInvites).values({
    showId,
    token: generateToken(),
    role,
    maxUses,
    expiresAt,
    createdByRepId: rep.id,
  });
  revalidatePath(`/admin/shows/${showId}/team`);
}

export async function revokeInviteAction(formData: FormData) {
  await requireRep();
  const inviteId = String(formData.get('inviteId') ?? '');
  const showId = String(formData.get('showId') ?? '');
  if (!inviteId) throw new Error('inviteId required');
  await db
    .update(showInvites)
    .set({ revokedAt: new Date() })
    .where(eq(showInvites.id, inviteId));
  revalidatePath(`/admin/shows/${showId}/team`);
}

export async function removeMemberAction(formData: FormData) {
  await requireRep();
  const showId = String(formData.get('showId') ?? '');
  const repId = String(formData.get('repId') ?? '');
  if (!showId || !repId) throw new Error('showId + repId required');
  await db
    .delete(showReps)
    .where(and(eq(showReps.showId, showId), eq(showReps.repId, repId)));
  revalidatePath(`/admin/shows/${showId}/team`);
}
