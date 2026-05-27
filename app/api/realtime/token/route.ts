import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRep } from '@/lib/auth/currentRep';
import { getRealtimeProvider } from '@/lib/providers/realtime';
import { resolveProviderForKind } from '@/lib/providers/resolve';
import {
  buildAgentContext,
  buildToolDeclarations,
  loadFieldDefs,
  loadRecentLeads,
} from '@/lib/realtime/agentContext';
import { getShowMembership } from '@/lib/showAccess';

const requestSchema = z.object({
  showSlug: z.string().min(1),
  // Capture flow now auto-creates opportunities — code is optional here.
  opportunityCode: z
    .string()
    .optional()
    .transform((s) => (s ? s.toUpperCase() : undefined)),
  maxDurationSec: z.number().int().min(15).max(900).optional(),
});

/* Agent prompt + tool defs live in lib/realtime/agentContext.ts so the test
 * simulator and the production endpoint share exactly the same surface. */

export async function POST(request: NextRequest) {
  let rep;
  try {
    rep = await requireRep();
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const membership = await getShowMembership(rep.id, parsed.data.showSlug);
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this show' }, { status: 403 });
  }

  const resolved = await resolveProviderForKind({
    showId: membership.show.id,
    kind: 'realtime',
    overrideConfigId: membership.show.realtimeProviderConfigId,
    purpose: 'realtime_token_mint',
    accessedByRepId: rep.id,
  });
  if (!resolved) {
    return NextResponse.json(
      {
        error:
          'No realtime provider configured and no DEFAULT_GEMINI_API_KEY env var set. Configure one at /admin/configs.',
      },
      { status: 400 },
    );
  }
  const { config: realtimeConfig, credential } = resolved;
  const provider = getRealtimeProvider(realtimeConfig);

  const [fields, recentLeads] = await Promise.all([
    loadFieldDefs(membership.show.id),
    loadRecentLeads(membership.show.id),
  ]);

  const instructions = await buildAgentContext({
    showId: membership.show.id,
    opportunityCode: parsed.data.opportunityCode,
    repName: rep.displayName ?? rep.email,
    showName: membership.show.name,
    fields,
    recentLeads,
  });

  try {
    const result = await provider.mintEphemeralToken({
      ctx: { config: realtimeConfig, credential, captureId: 'realtime_session' },
      instructions,
      maxDurationSec: parsed.data.maxDurationSec ?? 90,
      tools: [{ functionDeclarations: buildToolDeclarations(fields, recentLeads) }],
    });
    return NextResponse.json({
      ...result,
      providerConfigId: realtimeConfig.id,
      requiredFields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
      })),
      existingLeads: recentLeads.map((l) => ({
        opportunityCode: l.opportunityCode,
        knownFields: l.knownFields,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export const runtime = 'nodejs';
