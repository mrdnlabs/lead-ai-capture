import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/currentRep';
import { getShowMembership } from '@/lib/showAccess';
import { resolveProviderForKind } from '@/lib/providers/resolve';
import { tryFallbackProvider } from '@/lib/providers/fallback';

/**
 * Admin-only diagnostic: tells us which API key the realtime path would use,
 * showing source (DB vs env fallback) and first4 + last4 chars so we can
 * compare against what the admin expects. Never returns the full key.
 *
 * Usage: GET /api/debug/realtime-key?showSlug=demo
 */
export async function GET(request: NextRequest): Promise<Response> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const showSlug = request.nextUrl.searchParams.get('showSlug') ?? 'demo';
  const membership = await getShowMembership(admin.id, showSlug);
  if (!membership) {
    return NextResponse.json({ error: `Not a member of show "${showSlug}"` }, { status: 404 });
  }

  try {
    const resolved = await resolveProviderForKind({
      showId: membership.show.id,
      kind: 'realtime',
      overrideConfigId: membership.show.realtimeProviderConfigId,
      purpose: 'debug_inspect',
      accessedByRepId: admin.id,
    });
    if (!resolved) {
      return NextResponse.json({
        source: 'none',
        message: 'No DB config AND no DEFAULT_GEMINI_API_KEY env var. Realtime will fail.',
      });
    }
    const key = resolved.credential.apiKey;
    const fallback = tryFallbackProvider('realtime');
    const fallbackInfo = fallback
      ? {
          available: true,
          keyLength: fallback.credential.apiKey.length,
          keyFirst4: fallback.credential.apiKey.slice(0, 4),
          keyLast4: fallback.credential.apiKey.slice(-4),
          matchesPrimary: fallback.credential.apiKey === key,
        }
      : { available: false };
    return NextResponse.json({
      primary: {
        source: resolved.isFallback ? 'env_fallback (DEFAULT_GEMINI_API_KEY)' : 'db_credential',
        provider: resolved.config.provider,
        model: resolved.config.model,
        configLabel: resolved.config.label,
        keyLength: key.length,
        keyFirst4: key.slice(0, 4),
        keyLast4: key.slice(-4),
        keyStartsWithAIza: key.startsWith('AIza'),
        keyContainsWhitespace: /\s/.test(key),
      },
      fallback: fallbackInfo,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, hint: 'Likely KEK mismatch — decryption failed' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
