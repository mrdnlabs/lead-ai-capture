import { redirect } from 'next/navigation';
import { requireRep } from '@/lib/auth/currentRep';
import { getOpportunityByCode, getShowMembership } from '@/lib/showAccess';
import { QueuePill } from '@/components/QueuePill';
import { ShareOpportunity } from './ShareOpportunity';
import { CaptureRecorder } from './CaptureRecorder';

interface Params {
  params: Promise<{ showCode: string }>;
  searchParams: Promise<{ opp?: string }>;
}

export default async function CapturePage({ params, searchParams }: Params) {
  const { showCode } = await params;
  const { opp = 'DEMO01' } = await searchParams;

  const rep = await requireRep().catch(() => null);
  if (!rep) redirect(`/auth/signin?next=/s/${showCode}/capture`);

  const membership = await getShowMembership(rep.id, showCode);
  if (!membership) {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-neutral-500">
          You&rsquo;re not a member of show <code>{showCode}</code>.
        </p>
      </main>
    );
  }

  const opportunity = await getOpportunityByCode(membership.show.id, opp);
  if (!opportunity) {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="text-xl font-semibold">Opportunity not found</h1>
        <p className="mt-2 text-sm text-neutral-500">
          No opportunity with code <code>{opp}</code> in show <code>{showCode}</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {membership.show.name}
          </div>
          <h1 className="text-xl font-semibold">Capture lead</h1>
          <div className="mt-1 text-sm text-neutral-500">
            Opportunity <code className="font-mono">{opportunity.code}</code>
          </div>
        </div>
        <QueuePill />
      </header>
      <CaptureRecorder
        showSlug={showCode}
        opportunityCode={opportunity.code}
        leadsUrl={`/s/${showCode}/leads`}
      />
      <ShareOpportunity showSlug={showCode} opportunityCode={opportunity.code} />
    </main>
  );
}
