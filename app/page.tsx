import { getCurrentRep, isAdmin } from '@/lib/auth/currentRep';

export default async function HomePage() {
  const rep = await getCurrentRep();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">AI Capture</h1>
      <p className="mt-2 text-sm text-neutral-500">Trade-show lead capture, AI-native.</p>

      <section className="mt-8 rounded-lg border border-neutral-200 p-4 text-sm">
        <div className="font-medium">Signed in</div>
        <div className="mt-1 text-neutral-600">
          {rep?.email} <span className="text-neutral-400">·</span>{' '}
          <span className="text-xs uppercase tracking-wide">{rep?.role}</span>
        </div>
        <form action="/auth/signout" method="post" className="mt-3">
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
          >
            Sign out
          </button>
        </form>
      </section>

      <nav className="mt-8 space-y-2 text-sm">
        <div className="font-medium text-neutral-900">Where to next</div>
        <ul className="space-y-1 text-neutral-600">
          <li>
            <a className="underline-offset-2 hover:underline" href="/s/demo/capture">
              Capture page (Phase 1)
            </a>
          </li>
          <li>
            <a className="underline-offset-2 hover:underline" href="/s/demo/leads">
              Display mode
            </a>
          </li>
          {isAdmin(rep) ? (
            <li>
              <a className="underline-offset-2 hover:underline" href="/admin/providers">
                Admin — provider credentials
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
    </main>
  );
}
