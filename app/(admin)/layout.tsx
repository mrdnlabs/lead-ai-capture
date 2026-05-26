import { redirect } from 'next/navigation';
import { getCurrentRep, isAdmin } from '@/lib/auth/currentRep';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const rep = await getCurrentRep();
  if (!rep) redirect('/auth/signin?next=/admin/providers');
  if (!isAdmin(rep)) redirect('/?error=admin_required');

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="text-sm font-medium">Admin · AI Capture</div>
          <nav className="space-x-4 text-sm">
            <a className="underline-offset-2 hover:underline" href="/admin/providers">
              Providers
            </a>
            <a className="text-neutral-500 hover:text-neutral-900" href="/">
              ← Back to app
            </a>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
