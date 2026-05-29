import { redirect } from 'next/navigation';
import { isAdmin, requireRep } from '@/lib/auth/currentRep';
import { getShowMembership, listShowsForRep } from '@/lib/showAccess';
import { CaptureRecorder } from './CaptureRecorder';

interface Params {
  params: Promise<{ showCode: string }>;
}

function isTodayWindow(startsAt: Date | null, endsAt: Date | null): boolean {
  if (!startsAt) return false;
  const now = Date.now();
  const s = startsAt.getTime();
  const e = endsAt ? endsAt.getTime() : s + 86_400_000; // 1-day window if no end
  return now >= s && now <= e;
}

function formatWhen(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt) return '';
  if (isTodayWindow(startsAt, endsAt)) return 'Today';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = startsAt.toLocaleDateString(undefined, opts);
  if (!endsAt) return s;
  const e = endsAt.toLocaleDateString(undefined, opts);
  return s === e ? s : `${s}–${e}`;
}

export default async function CapturePage({ params }: Params) {
  const { showCode } = await params;

  const rep = await requireRep().catch(() => null);
  if (!rep) redirect(`/auth/signin?next=/s/${showCode}/capture`);

  const [membership, allShows] = await Promise.all([
    getShowMembership(rep.id, showCode),
    listShowsForRep(rep.id),
  ]);

  if (!membership) {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="t-title">No access</h1>
        <p className="mt-2 t-meta">
          You&rsquo;re not a member of show <span className="op-code">{showCode}</span>.
        </p>
      </main>
    );
  }

  return (
    <CaptureRecorder
      showSlug={showCode}
      show={{ slug: membership.show.slug, name: membership.show.name }}
      shows={allShows.map((s) => ({
        slug: s.slug,
        name: s.name,
        leadCount: s.leadCount,
        when: formatWhen(s.startsAt, s.endsAt),
        isToday: isTodayWindow(s.startsAt, s.endsAt),
      }))}
      leadsUrl={`/s/${showCode}/leads`}
      isAdmin={isAdmin(rep)}
    />
  );
}
