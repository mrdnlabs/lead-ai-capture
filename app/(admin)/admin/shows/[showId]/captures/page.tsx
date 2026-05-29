export const dynamic = 'force-dynamic';

import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { captures, leads, opportunities, reps, shows } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';

interface Params {
  params: Promise<{ showId: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-neutral-100 text-neutral-600',
  uploaded: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  processed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function leadName(merged: Record<string, unknown> | null | undefined): string {
  if (!merged) return '—';
  const name = merged.name ?? [merged.first_name, merged.last_name].filter(Boolean).join(' ');
  if (typeof name === 'string' && name.trim()) return name;
  if (typeof merged.company === 'string' && merged.company.trim()) return merged.company;
  return '(unnamed)';
}

export default async function ShowCapturesPage({ params }: Params) {
  await requireAdmin();
  const { showId } = await params;

  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) redirect('/admin/shows');

  const rows = await db
    .select({
      capture: captures,
      lead: leads,
      rep: reps,
    })
    .from(captures)
    .leftJoin(opportunities, eq(opportunities.id, captures.opportunityId))
    .leftJoin(leads, eq(leads.opportunityId, captures.opportunityId))
    .leftJoin(reps, eq(reps.id, captures.repId))
    .where(eq(captures.showId, showId))
    .orderBy(desc(captures.serverReceivedAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <header>
        <a href="/admin/shows" className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          ← Admin · shows
        </a>
        <h1 className="mt-2 text-xl font-semibold">Captures</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {show.name} · {rows.length} most recent. Click a capture to review the raw audio + photo
          against what the AI extracted.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Capture</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Rep</th>
              <th className="px-4 py-2 font-medium">Media</th>
              <th className="px-4 py-2 font-medium">Captured</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  No captures for this show yet.
                </td>
              </tr>
            ) : (
              rows.map(({ capture, lead, rep }) => (
                <tr key={capture.id} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/shows/${showId}/captures/${capture.id}`}
                      className="font-mono text-xs text-neutral-900 underline-offset-2 hover:underline"
                    >
                      {capture.id.slice(0, 8)}
                    </a>
                    {capture.hadRealtimeAssist ? (
                      <span className="ml-2 inline-flex rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        AI
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{leadName(lead?.mergedFields)}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{rep?.email ?? '—'}</td>
                  <td className="px-4 py-3 text-base" title="audio / photo">
                    {capture.audioBlobKey ? '🎙' : <span className="text-neutral-300">🎙</span>}{' '}
                    {capture.photoBlobKey ? '📷' : <span className="text-neutral-300">📷</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {new Date(capture.serverReceivedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (STATUS_STYLES[capture.status] ?? 'bg-neutral-100 text-neutral-600')
                      }
                    >
                      {capture.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
