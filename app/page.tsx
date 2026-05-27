import { redirect } from 'next/navigation';
import { getCurrentRep } from '@/lib/auth/currentRep';
import { listShowsForRep } from '@/lib/showAccess';
import { BrandMark } from '@/components/ui/BrandMark';

export default async function HomePage() {
  const rep = await getCurrentRep();
  if (!rep) redirect('/auth/signin');

  const shows = await listShowsForRep(rep.id);

  // Prefer the show whose window includes today; otherwise the most recently
  // started. This is the rep's "primary" show for the current moment.
  const now = Date.now();
  const today = shows.find((s) => {
    if (!s.startsAt) return false;
    const start = s.startsAt.getTime();
    const end = s.endsAt ? s.endsAt.getTime() : start + 86_400_000;
    return now >= start && now <= end;
  });
  const target = today ?? shows[0];

  if (target) {
    redirect(`/s/${target.slug}/capture`);
  }

  // No shows yet — render a small empty state. The admin needs to invite
  // this rep to a show (or the rep needs to join via an invite link).
  return (
    <main className="scr">
      <div className="scr-top">
        <BrandMark />
      </div>
      <div className="scr-body items-center justify-center text-center">
        <div className="t-eyebrow">No shows yet</div>
        <h1 className="t-title mt-2">You&rsquo;re not on any shows.</h1>
        <p className="t-body mt-3 max-w-xs text-ink-3">
          Ask the show admin for an invite link, or open one you already have.
        </p>
        <form action="/auth/signout" method="post" className="mt-8">
          <button type="submit" className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </form>
      </div>
      <div className="scr-foot text-center">
        <BrandMark subtle />
      </div>
    </main>
  );
}
