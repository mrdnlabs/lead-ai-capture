import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { customFieldDefinitions } from '@/db/schema';
import { buildLeadSchema } from '@/lib/ai/schemaBuilder';
import { requireRep } from '@/lib/auth/currentRep';
import { getVisionProvider } from '@/lib/providers';
import { resolveProviderForKind } from '@/lib/providers/resolve';
import { getShowMembership } from '@/lib/showAccess';

/**
 * Synchronous badge/business-card OCR for the live AI-assist session.
 *
 * Runs the same vision pipeline `processCapture` uses post-submit, but
 * returns structured fields immediately so the client can inject them into
 * the live WSS conversation as facts the AI can reason about. The image is
 * NOT persisted here — the canonical persistence happens via /api/captures
 * on Submit. This endpoint is a transient helper.
 */
export async function POST(request: NextRequest) {
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

  const showSlug = form.get('showSlug');
  const photo = form.get('photo');
  const parsed = z
    .object({ showSlug: z.string().min(1) })
    .safeParse({ showSlug });
  if (!parsed.success) {
    return NextResponse.json({ error: 'showSlug is required' }, { status: 400 });
  }
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: 'photo file is required' }, { status: 400 });
  }

  const membership = await getShowMembership(rep.id, parsed.data.showSlug);
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this show' }, { status: 403 });
  }

  const resolved = await resolveProviderForKind({
    showId: membership.show.id,
    kind: 'vision',
    overrideConfigId: membership.show.visionProviderConfigId,
    purpose: 'realtime_vision_extract',
    accessedByRepId: rep.id,
  });
  if (!resolved) {
    return NextResponse.json(
      {
        error:
          'No vision provider configured for this show and no DEFAULT_GEMINI_API_KEY fallback set.',
      },
      { status: 400 },
    );
  }

  // Match the schema processCapture uses so the AI sees a familiar shape.
  const customFields = membership.show.leadFormId
    ? await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.leadFormId, membership.show.leadFormId))
    : [];
  const leadSchema = buildLeadSchema(customFields);

  // Same instructions string as processCapture's vision step — keeps both
  // passes producing comparable output.
  const instructions =
    resolved.config.defaultInstructions ||
    "You are looking at a photo of a person's trade-show name badge or business card. Extract the visible fields. If a field is not visible or unreadable, leave it out — do not guess.";

  try {
    const bytes = Buffer.from(await photo.arrayBuffer());
    const provider = getVisionProvider(resolved.config);
    const result = await provider.extractFromImage({
      ctx: {
        config: resolved.config,
        credential: resolved.credential,
        // No captureId yet — this image hasn't been persisted. Use a sentinel
        // so audit logs make it clear this was a live/realtime call.
        captureId: 'realtime_vision_extract',
      },
      image: bytes,
      mimeType: photo.type || 'image/jpeg',
      schema: leadSchema,
      instructions,
    });

    return NextResponse.json({
      fields: result.fields as Record<string, unknown>,
      modelVersion: result.modelVersion,
      latencyMs: result.latencyMs,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[vision-extract] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export const runtime = 'nodejs';
export const maxDuration = 30;
