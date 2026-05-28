export const dynamic = 'force-dynamic';

import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { leadForms, shows } from '@/db/schema';
import { NewShowForm } from './NewShowForm';

export default async function ShowsAdminPage() {
  const rows = await db
    .select({
      show: shows,
      leadForm: leadForms,
    })
    .from(shows)
    .leftJoin(leadForms, eq(leadForms.id, shows.leadFormId))
    .orderBy(desc(shows.createdAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Shows</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Per-show settings. The most important one is the lead form — it defines the iCapture CSV
          columns we&rsquo;ll export and the field keys we extract into.
        </p>
      </header>

      <ul className="space-y-2">
        {rows.map(({ show, leadForm }) => (
          <li
            key={show.id}
            className="rounded-lg border border-neutral-200 px-4 py-3 text-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="font-medium text-neutral-900">{show.name}</div>
              <div className="text-xs text-neutral-500">
                <code className="font-mono">{show.slug}</code> ·{' '}
                {leadForm
                  ? `Lead form: ${leadForm.name}`
                  : 'No lead form yet (captures will use default fields)'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/admin/shows/${show.id}/team`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
              >
                Team &amp; invites
              </a>
              <a
                href={`/admin/shows/${show.id}/lead-form`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
              >
                {leadForm ? 'Edit lead form' : 'Set up lead form'}
              </a>
            </div>
          </li>
        ))}
      </ul>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-medium">New show</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Creates a show, auto-adds you as admin, then sends you to set up the lead form.
        </p>
        <NewShowForm />
      </section>
    </div>
  );
}
