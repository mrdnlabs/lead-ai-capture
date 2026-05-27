import { eq } from 'drizzle-orm';
import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { captures, mediaBlobs, opportunities } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { processCapture } from '@/lib/processing/processCapture';
import {
  AUDIO_BUCKET,
  PHOTO_BUCKET,
  audioKey,
  photoKey,
  uploadBlob,
} from '@/lib/storage/server';
import { getOpportunityByCode, getShowMembership } from '@/lib/showAccess';

const metadataSchema = z.object({
  showSlug: z.string().min(1),
  // Empty/missing → server auto-creates a placeholder opportunity. AI dedupe re-targets later.
  opportunityCode: z
    .string()
    .optional()
    .transform((s) => (s ? s.toUpperCase() : undefined)),
  idempotencyKey: z.string().uuid(),
  clientCapturedAt: z.string().datetime(),
  durationMs: z.coerce.number().int().nonnegative().optional(),
});

function randomOpportunityCode(): string {
  // 6-char alphanumeric (uppercase, no ambiguous chars). ~30B combos per show.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function POST(request: NextRequest): Promise<Response> {
  let rep;
  try {
    rep = await requireRep();
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse({
    showSlug: form.get('showSlug'),
    // FormData returns null for missing fields — Zod `.optional()` doesn't accept null
    opportunityCode: form.get('opportunityCode') ?? undefined,
    idempotencyKey: form.get('idempotencyKey'),
    clientCapturedAt: form.get('clientCapturedAt'),
    durationMs: form.get('durationMs') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }
  const meta = parsed.data;

  const audio = form.get('audio');
  const photo = form.get('photo');
  if (!(audio instanceof File) && !(photo instanceof File)) {
    return NextResponse.json({ error: 'At least one of audio or photo is required' }, { status: 400 });
  }

  // Optional live-conversation transcript captured from Gemini Live during recording
  let realtimeTranscript: Array<{ role: 'user' | 'assistant'; text: string; at: number }> | null = null;
  const transcriptField = form.get('realtimeTranscript');
  if (typeof transcriptField === 'string' && transcriptField.length > 0) {
    try {
      const parsed = JSON.parse(transcriptField);
      if (Array.isArray(parsed)) realtimeTranscript = parsed;
    } catch {
      /* malformed transcript — ignore, not fatal */
    }
  }

  // Optional liveFields: values the AI captured via set_lead_field tool calls
  // during the live conversation. High signal — rep verbally confirmed each.
  let liveFields: Record<string, { value: string; confidence?: number; at: number }> | null = null;
  const liveFieldsField = form.get('liveFields');
  if (typeof liveFieldsField === 'string' && liveFieldsField.length > 0) {
    try {
      const parsed = JSON.parse(liveFieldsField);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        liveFields = parsed;
      }
    } catch {
      /* malformed liveFields — ignore, not fatal */
    }
  }

  const membership = await getShowMembership(rep.id, meta.showSlug);
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this show' }, { status: 403 });
  }

  // Resolve or create the opportunity. Most captures arrive with no code now;
  // AI dedupe later in processCapture can re-point the capture to an existing
  // opportunity if it's actually the same lead.
  let opportunity = meta.opportunityCode
    ? await getOpportunityByCode(membership.show.id, meta.opportunityCode)
    : null;
  if (!opportunity) {
    const code = meta.opportunityCode ?? randomOpportunityCode();
    try {
      const [created] = await db
        .insert(opportunities)
        .values({
          showId: membership.show.id,
          code,
          status: 'open',
          createdByRepId: rep.id,
        })
        .returning();
      opportunity = created;
    } catch (e) {
      // Unique violation on (showId, code) — try one retry with a different code.
      const err = e as { code?: string };
      if (err.code === '23505') {
        const [retry] = await db
          .insert(opportunities)
          .values({
            showId: membership.show.id,
            code: randomOpportunityCode(),
            status: 'open',
            createdByRepId: rep.id,
          })
          .returning();
        opportunity = retry;
      } else {
        throw e;
      }
    }
  }

  const existing = await db
    .select()
    .from(captures)
    .where(eq(captures.idempotencyKey, meta.idempotencyKey))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({
      captureId: existing[0].id,
      audioBlobKey: existing[0].audioBlobKey,
      photoBlobKey: existing[0].photoBlobKey,
      status: existing[0].status,
      idempotent: true,
    });
  }

  const captureId = crypto.randomUUID();
  let audioBlobKey: string | null = null;
  let photoBlobKey: string | null = null;

  try {
    if (audio instanceof File && audio.size > 0) {
      audioBlobKey = audioKey(membership.show.id, rep.id, captureId, audio.type);
      await uploadBlob({
        bucket: AUDIO_BUCKET,
        key: audioBlobKey,
        file: audio,
        contentType: audio.type,
      });
    }
    if (photo instanceof File && photo.size > 0) {
      photoBlobKey = photoKey(membership.show.id, rep.id, captureId, photo.type);
      await uploadBlob({
        bucket: PHOTO_BUCKET,
        key: photoBlobKey,
        file: photo,
        contentType: photo.type,
      });
    }
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  await db.transaction(async (tx) => {
    await tx.insert(captures).values({
      id: captureId,
      idempotencyKey: meta.idempotencyKey,
      opportunityId: opportunity.id,
      showId: membership.show.id,
      repId: rep.id,
      audioBlobKey,
      photoBlobKey,
      durationMs: meta.durationMs ?? null,
      hadRealtimeAssist: realtimeTranscript !== null,
      realtimeTranscript: realtimeTranscript ?? undefined,
      liveFields: liveFields ?? undefined,
      status: 'uploaded',
      clientCapturedAt: new Date(meta.clientCapturedAt),
    });

    if (audioBlobKey && audio instanceof File) {
      await tx.insert(mediaBlobs).values({
        key: audioBlobKey,
        captureId,
        kind: 'audio',
        mimeType: audio.type,
        sizeBytes: audio.size,
      });
    }
    if (photoBlobKey && photo instanceof File) {
      await tx.insert(mediaBlobs).values({
        key: photoBlobKey,
        captureId,
        kind: 'photo',
        mimeType: photo.type,
        sizeBytes: photo.size,
      });
    }
  });

  // Non-blocking AI processing: runs after the response is sent.
  after(async () => {
    try {
      await processCapture({ captureId });
    } catch (e) {
      console.error(`[processCapture] capture ${captureId} failed:`, (e as Error).message);
    }
  });

  return NextResponse.json({
    captureId,
    audioBlobKey,
    photoBlobKey,
    status: 'uploaded',
  });
}

export const runtime = 'nodejs';
export const maxDuration = 60;
