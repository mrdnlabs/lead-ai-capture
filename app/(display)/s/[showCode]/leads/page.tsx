import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { captures, opportunities, reps } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { getShowMembership } from '@/lib/showAccess';

interface Params {
  params: Promise<{ showCode: string }>;
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export const dynamic = 'force-dynamic';

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

  const rows = await db
    .select({
      capture: captures,
      opportunity: opportunities,
      rep: reps,
    })
    .from(captures)
    .innerJoin(opportunities, eq(opportunities.id, captures.opportunityId))
    .innerJoin(reps, eq(reps.id, captures.repId))
    .where(eq(captures.showId, membership.show.id))
    .orderBy(desc(captures.serverReceivedAt))
    .limit(100);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {membership.show.name}
          </div>
          <h1 className="text-xl font-semibold">Captures · {rows.length}</h1>
        </div>
        <a
          href={`/s/${showCode}/capture`}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          New capture
        </a>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center text-sm text-neutral-500">
          No captures yet. Hit New capture to add one.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ capture, opportunity, rep: capRep }) => (
            <li
              key={capture.id}
              className="rounded-lg border border-neutral-200 p-4 text-sm"
            >
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-xs text-neutral-500">{capture.id.slice(0, 8)}</div>
                <div className="text-xs text-neutral-500">{fmt(capture.serverReceivedAt)}</div>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-neutral-900">
                  Opportunity <code className="font-mono">{opportunity.code}</code>
                </span>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-700">{capRep.email}</span>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-700">
                  {capture.audioBlobKey ? 'audio' : null}
                  {capture.audioBlobKey && capture.photoBlobKey ? ' + ' : ''}
                  {capture.photoBlobKey ? 'photo' : null}
                </span>
                {capture.durationMs ? (
                  <>
                    <span className="text-neutral-500">·</span>
                    <span className="text-neutral-500">{fmtDuration(capture.durationMs)}</span>
                  </>
                ) : null}
                <span className="text-neutral-500">·</span>
                <span
                  className={
                    capture.status === 'processed'
                      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
                      : capture.status === 'failed'
                        ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700'
                        : 'rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700'
                  }
                >
                  {capture.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
