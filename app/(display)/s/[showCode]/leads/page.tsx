import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { captures, leads, opportunities, reps } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { getShowMembership } from '@/lib/showAccess';
import { LeadsView, type LeadCardData } from './LeadsView';

interface Params {
  params: Promise<{ showCode: string }>;
}

export const dynamic = 'force-dynamic';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function LeadsPage({ params }: Params) {
  const { showCode } = await params;
  const rep = await requireRep().catch(() => null);
  if (!rep) redirect(`/auth/signin?next=/s/${showCode}/leads`);

  const membership = await getShowMembership(rep.id, showCode);
  if (!membership) {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="t-title">No access</h1>
        <p className="t-meta mt-2">
          You&rsquo;re not a member of show <span className="op-code">{showCode}</span>.
        </p>
      </main>
    );
  }

  // Fetch leads joined to their opportunities for this show.
  const leadRows = await db
    .select({
      lead: leads,
      opportunity: opportunities,
    })
    .from(leads)
    .innerJoin(opportunities, eq(opportunities.id, leads.opportunityId))
    .where(eq(opportunities.showId, membership.show.id))
    .orderBy(desc(leads.lastUpdatedAt));

  const captureRows = await db
    .select({ capture: captures, rep: reps })
    .from(captures)
    .innerJoin(reps, eq(reps.id, captures.repId))
    .where(eq(captures.showId, membership.show.id));
  const capturesByOpp = new Map<string, typeof captureRows>();
  for (const row of captureRows) {
    const arr = capturesByOpp.get(row.capture.opportunityId) ?? [];
    arr.push(row);
    capturesByOpp.set(row.capture.opportunityId, arr);
  }

  const cards: LeadCardData[] = leadRows.map(({ lead, opportunity }) => {
    const f = lead.mergedFields as Record<string, unknown>;
    const oppCaps = capturesByOpp.get(opportunity.id) ?? [];
    const lastTouchedBy = oppCaps[0]?.rep.email ?? rep.email;
    const repEmails = Array.from(new Set(oppCaps.map((c) => c.rep.email)));
    const name =
      asString(f.name) ||
      [asString(f.first_name), asString(f.last_name)].filter(Boolean).join(' ') ||
      '(no name yet)';
    const confidence = lead.confidenceScores as Record<string, number>;
    const avgConfidence =
      Object.values(confidence).length > 0
        ? Object.values(confidence).reduce((a, b) => a + b, 0) / Object.values(confidence).length
        : 0;

    return {
      opportunityCode: opportunity.code,
      name,
      company: asString(f.company),
      title: asString(f.title),
      email: asString(f.email),
      phone: asString(f.phone),
      interest: asString(f.interest_level) ?? asString(f.interest),
      missingFields: lead.missingFields,
      captureCount: oppCaps.length,
      lastUpdatedAt: lead.lastUpdatedAt.toISOString(),
      avgConfidence,
      isMine: repEmails.includes(rep.email),
      repInitials: repEmails.map((e) => e[0]?.toUpperCase() ?? '?').slice(0, 3),
    };
  });

  return (
    <LeadsView
      showSlug={showCode}
      showName={membership.show.name}
      leads={cards}
    />
  );
}
