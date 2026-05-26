import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { captures, leads, opportunities, reps } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { getShowMembership } from '@/lib/showAccess';

interface Params {
  params: Promise<{ showCode: string }>;
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

export const dynamic = 'force-dynamic';

const STANDARD_FIELD_ORDER = ['name', 'title', 'company', 'email', 'phone', 'notes'] as const;
const STANDARD_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Title',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
};

function FieldValue({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="text-neutral-400">—</span>;
  if (Array.isArray(value)) return <span>{value.join(', ')}</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  return <span>{String(value)}</span>;
}

export default async function LeadsPage({ params }: Params) {
  const { showCode } = await params;
  const rep = await requireRep().catch(() => null);
  if (!rep) redirect(`/auth/signin?next=/s/${showCode}/leads`);

  const membership = await getShowMembership(rep.id, showCode);
  if (!membership) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-neutral-500">
          You&rsquo;re not a member of show <code>{showCode}</code>.
        </p>
      </main>
    );
  }

  // Get all opportunities for this show, with their lead (if any) and captures
  const opps = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.showId, membership.show.id))
    .orderBy(desc(opportunities.createdAt));

  const leadRows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(opportunities, eq(opportunities.id, leads.opportunityId))
    .where(eq(opportunities.showId, membership.show.id));
  const leadsById = new Map(leadRows.map(({ lead }) => [lead.opportunityId, lead] as const));

  const captureRows = await db
    .select({
      capture: captures,
      rep: reps,
    })
    .from(captures)
    .innerJoin(reps, eq(reps.id, captures.repId))
    .where(eq(captures.showId, membership.show.id))
    .orderBy(desc(captures.serverReceivedAt));
  const capturesByOpp = new Map<string, typeof captureRows>();
  for (const row of captureRows) {
    const arr = capturesByOpp.get(row.capture.opportunityId) ?? [];
    arr.push(row);
    capturesByOpp.set(row.capture.opportunityId, arr);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {membership.show.name}
          </div>
          <h1 className="text-xl font-semibold">Leads · {opps.length}</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/shows/${showCode}/export.csv`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
          >
            Export CSV
          </a>
          <a
            href={`/s/${showCode}/capture`}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            New capture
          </a>
        </div>
      </header>

      {opps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center text-sm text-neutral-500">
          No opportunities yet.
        </div>
      ) : (
        <ul className="space-y-6">
          {opps.map((opp) => {
            const lead = leadsById.get(opp.id);
            const oppCaptures = capturesByOpp.get(opp.id) ?? [];
            const mergedKeys = lead ? Object.keys(lead.mergedFields) : [];
            const customKeys = mergedKeys.filter(
              (k) => !STANDARD_FIELD_ORDER.includes(k as (typeof STANDARD_FIELD_ORDER)[number]),
            );

            return (
              <li key={opp.id} className="rounded-lg border border-neutral-200">
                <header className="flex items-baseline justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2">
                  <div className="text-sm">
                    <span className="font-medium text-neutral-900">
                      {(lead?.mergedFields.name as string) ?? '(no name yet)'}
                    </span>
                    <span className="ml-2 text-neutral-500">
                      Opportunity <code className="font-mono">{opp.code}</code>
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {oppCaptures.length} capture{oppCaptures.length === 1 ? '' : 's'}
                  </div>
                </header>

                {lead ? (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
                    {STANDARD_FIELD_ORDER.map((k) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-neutral-500">
                          {STANDARD_FIELD_LABELS[k]}
                        </dt>
                        <dd className="text-neutral-900">
                          <FieldValue value={lead.mergedFields[k]} />
                        </dd>
                      </div>
                    ))}
                    {customKeys.map((k) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-neutral-500">
                          {k}
                        </dt>
                        <dd className="text-neutral-900">
                          <FieldValue value={lead.mergedFields[k]} />
                        </dd>
                      </div>
                    ))}
                    {lead.missingFields.length > 0 ? (
                      <div className="col-span-full mt-2 flex flex-wrap gap-1">
                        <span className="text-xs uppercase tracking-wide text-neutral-500">
                          Missing:
                        </span>
                        {lead.missingFields.map((m) => (
                          <span
                            key={m}
                            className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <div className="px-4 py-3 text-sm text-neutral-500">
                    No lead data yet — captures haven&rsquo;t been processed or there&rsquo;s no
                    provider config.
                  </div>
                )}

                <details className="border-t border-neutral-100 px-4 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-neutral-600">
                    {oppCaptures.length} capture{oppCaptures.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {oppCaptures.map(({ capture, rep: capRep }) => (
                      <li key={capture.id} className="flex flex-wrap gap-x-3 text-neutral-600">
                        <span className="font-mono">{capture.id.slice(0, 8)}</span>
                        <span>{fmt(capture.serverReceivedAt)}</span>
                        <span>{capRep.email}</span>
                        <span>
                          {capture.audioBlobKey ? 'audio' : ''}
                          {capture.audioBlobKey && capture.photoBlobKey ? ' + ' : ''}
                          {capture.photoBlobKey ? 'photo' : ''}
                        </span>
                        <span
                          className={
                            capture.status === 'processed'
                              ? 'text-green-700'
                              : capture.status === 'failed'
                                ? 'text-red-700'
                                : 'text-neutral-500'
                          }
                        >
                          {capture.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
