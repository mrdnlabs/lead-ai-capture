import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { customFieldDefinitions, leadForms, leads, opportunities } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { getRealtimeProvider } from '@/lib/providers/realtime';
import { resolveProviderForKind } from '@/lib/providers/resolve';
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

async function buildAgentContext(
  showId: string,
  opportunityCode: string | undefined,
  repName: string | null,
  showName: string,
) {
  const [opp] = opportunityCode
    ? await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.showId, showId), eq(opportunities.code, opportunityCode)))
        .limit(1)
    : [];
  const [lead] = opp
    ? await db.select().from(leads).where(eq(leads.opportunityId, opp.id)).limit(1)
    : [];

  let formFields: Array<{ key: string; label: string; aiHint: string | null }> = [];
  const [showRow] = await db.select().from((await import('@/db/schema')).shows).where(eq((await import('@/db/schema')).shows.id, showId)).limit(1);
  if (showRow?.leadFormId) {
    const [form] = await db.select().from(leadForms).where(eq(leadForms.id, showRow.leadFormId)).limit(1);
    if (form) {
      const defs = await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.leadFormId, form.id));
      formFields = defs.map((d) => ({
        key: d.key,
        label: d.label,
        aiHint: d.aiExtractionHint,
      }));
    }
  }

  const known = lead?.mergedFields ?? {};
  const missing = lead?.missingFields ?? [];

  return `You are a trade-show lead-capture assistant helping ${repName ?? 'a rep'} at "${showName}".
You and the rep are having a short voice conversation about a lead they just met.

CURRENT KNOWN INFO about this lead${opportunityCode ? ` (opportunity ${opportunityCode})` : ' (new — opportunity will be assigned by AI dedupe later)'}:
${JSON.stringify(known, null, 2)}

FIELDS STILL MISSING (ask gap-filling questions ONLY about these — never repeat known info):
${missing.length > 0 ? missing.join(', ') : '(none yet — listen to learn the lead\'s basics: name, company, role, contact info, and any qualifying details)'}

GUIDELINES:
- Speak briefly and naturally, like a colleague taking notes.
- Ask ONE short question at a time.
- If the rep says "done" or "that's it", wrap up immediately.
- If they pause for more than 5 seconds, stay quiet — they're probably talking to the lead.
- Never invent details. Only capture what the rep actually says.
- Stop after 90 seconds even without "done".

LEAD FORM FIELDS (key → label):
${formFields.length > 0 ? formFields.map((f) => `  ${f.key}: ${f.label}${f.aiHint ? ` — ${f.aiHint}` : ''}`).join('\n') : '  (standard fields only: name, email, company, title, phone, notes)'}`;
}

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

  const instructions = await buildAgentContext(
    membership.show.id,
    parsed.data.opportunityCode,
    rep.displayName ?? rep.email,
    membership.show.name,
  );

  try {
    const result = await provider.mintEphemeralToken({
      ctx: { config: realtimeConfig, credential, captureId: 'realtime_session' },
      instructions,
      maxDurationSec: parsed.data.maxDurationSec ?? 90,
    });
    return NextResponse.json({
      ...result,
      providerConfigId: realtimeConfig.id,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export const runtime = 'nodejs';
