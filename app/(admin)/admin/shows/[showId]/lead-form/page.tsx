import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { customFieldDefinitions, leadForms, shows } from '@/db/schema';
import { LeadFormSetup } from './LeadFormSetup';
import type { FieldDef } from './actions';

interface Params {
  params: Promise<{ showId: string }>;
}

export default async function LeadFormPage({ params }: Params) {
  const { showId } = await params;
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) notFound();

  let initialName = '';
  let initialCsv = '';
  let initialFields: FieldDef[] = [];

  if (show.leadFormId) {
    const [form] = await db
      .select()
      .from(leadForms)
      .where(eq(leadForms.id, show.leadFormId))
      .limit(1);
    if (form) {
      initialName = form.name;
      initialCsv = form.sourceSampleCsv ?? '';
      const defs = await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.leadFormId, form.id))
        .orderBy(asc(customFieldDefinitions.ordering));
      initialFields = defs.map((d) => ({
        csvHeader: d.csvHeader,
        key: d.key,
        label: d.label,
        type: d.type,
        options: d.options ?? undefined,
        required: d.required,
        aiExtractionHint: d.aiExtractionHint ?? undefined,
      }));
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wide text-neutral-500">{show.name}</div>
        <h1 className="text-xl font-semibold">Lead form</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Defines the iCapture CSV columns we&rsquo;ll export. Paste a sample CSV — the AI infers
          field types and required-ness. Review, edit, save.
        </p>
      </header>
      <LeadFormSetup
        showId={show.id}
        initialName={initialName}
        initialCsv={initialCsv}
        initialFields={initialFields}
      />
    </div>
  );
}
