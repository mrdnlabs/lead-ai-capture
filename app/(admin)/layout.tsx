import { redirect } from 'next/navigation';
import { getCurrentRep, isAdmin } from '@/lib/auth/currentRep';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const rep = await getCurrentRep();
  if (!rep) redirect('/auth/signin?next=/admin/providers');
  if (!isAdmin(rep)) redirect('/?error=admin_required');

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Admin · AI Capture</div>
            <a className="text-xs text-neutral-500 hover:text-neutral-900 sm:hidden" href="/">
              ← App
            </a>
          </div>
          <nav className="-mx-1 flex flex-wrap gap-x-3 gap-y-1 text-xs sm:gap-x-4 sm:text-sm">
            <a className="px-1 underline-offset-2 hover:underline" href="/admin/providers">
              Credentials
            </a>
            <a className="px-1 underline-offset-2 hover:underline" href="/admin/configs">
              Configs
            </a>
            <a className="px-1 underline-offset-2 hover:underline" href="/admin/shows">
              Shows
            </a>
            <a className="px-1 underline-offset-2 hover:underline" href="/admin/analytics">
              Analytics
            </a>
            <a className="hidden px-1 text-neutral-500 hover:text-neutral-900 sm:inline" href="/">
              ← Back to app
            </a>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </div>
  );
}
