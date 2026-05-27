import { eq, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db/client';
import { showInvites, showReps, shows } from '@/db/schema';
import { getCurrentRep } from '@/lib/auth/currentRep';

interface Params {
  params: Promise<{ token: string }>;
}

function renderError(message: string, status = 400): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invite</title>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:64px auto;padding:0 24px;color:#0e0e0c;background:#fafaf6;}h1{font-size:22px;}p{color:#57564f;font-size:15px;line-height:1.5;}a{color:#0e0e0c;}</style>` +
      `</head><body><h1>Invite link</h1><p>${message}</p>` +
      `<p><a href="/auth/signin">Sign in</a></p>` +
      `</body></html>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

/**
 * GET /join/[token]
 *
 * Redeem a show-invite token. Behavior:
 *   1. Token must exist, not be revoked, not be expired, not be exhausted.
 *   2. If the rep isn't signed in → bounce to magic-link with `next=/join/<token>`
 *      so they end up back here after auth.
 *   3. If signed in → upsert show_reps membership at the invite's role,
 *      increment used_count, redirect to the show's capture screen.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { token } = await params;

  const [invite] = await db
    .select({ invite: showInvites, show: shows })
    .from(showInvites)
    .innerJoin(shows, eq(shows.id, showInvites.showId))
    .where(eq(showInvites.token, token))
    .limit(1);

  if (!invite) {
    return renderError(
      "This invite link isn't recognized. Ask the show admin for a fresh one.",
      404,
    );
  }
  const { invite: inv, show } = invite;
  if (inv.revokedAt) return renderError('This invite has been revoked.');
  if (inv.expiresAt.getTime() < Date.now()) return renderError('This invite has expired.');
  if (inv.usedCount >= inv.maxUses) {
    return renderError('This invite has reached its maximum number of uses.');
  }

  // Auth check.
  const rep = await getCurrentRep();
  if (!rep) {
    const next = `/join/${encodeURIComponent(token)}`;
    return NextResponse.redirect(
      `${request.nextUrl.origin}/auth/signin?next=${encodeURIComponent(next)}`,
    );
  }

  // Upsert membership at the invite's role. If the rep is already on the show,
  // idempotent no-op — and we still bump usedCount so the invite owner sees
  // the activity.
  await db
    .insert(showReps)
    .values({ showId: inv.showId, repId: rep.id, role: inv.role })
    .onConflictDoNothing();

  await db
    .update(showInvites)
    .set({ usedCount: sql`${showInvites.usedCount} + 1` })
    .where(eq(showInvites.id, inv.id));

  return NextResponse.redirect(`${request.nextUrl.origin}/s/${show.slug}/capture`);
}

export const runtime = 'nodejs';
