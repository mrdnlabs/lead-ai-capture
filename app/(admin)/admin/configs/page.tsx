import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { providerConfigs, providerCredentials } from '@/db/schema';
import { AddConfigForm } from './AddConfigForm';
import { ConfigActions } from './ConfigActions';

const KIND_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  vision: 'Vision',
  extraction: 'Extraction',
  realtime: 'Realtime voice',
};

const KIND_ORDER = ['transcription', 'vision', 'extraction', 'realtime'] as const;

export default async function ConfigsPage() {
  const configs = await db
    .select({
      config: providerConfigs,
      credentialLabel: providerCredentials.label,
      credentialLast4: providerCredentials.last4,
    })
    .from(providerConfigs)
    .leftJoin(providerCredentials, eq(providerCredentials.id, providerConfigs.credentialId))
    .orderBy(asc(providerConfigs.kind), desc(providerConfigs.isDefault), asc(providerConfigs.label));

  const credentials = await db
    .select()
    .from(providerCredentials)
    .where(eq(providerCredentials.isActive, true));

  const byKind: Record<string, typeof configs> = {};
  for (const c of configs) {
    (byKind[c.config.kind] ??= []).push(c);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Provider configs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Pair a provider + model with a stored credential. Mark one config as default per kind —
          captures use the default unless a show overrides it. Without configs, captures upload
          successfully but the AI pipeline is skipped.
        </p>
      </header>

      {KIND_ORDER.map((kind) => {
        const rows = byKind[kind] ?? [];
        return (
          <section key={kind} className="rounded-lg border border-neutral-200">
            <header className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
              <h2 className="text-sm font-medium">{KIND_LABELS[kind]}</h2>
            </header>
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-neutral-400">No configs for this kind.</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium">Provider</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 font-medium">Credential</th>
                    <th className="px-4 py-2 font-medium">Default</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ config, credentialLabel, credentialLast4 }) => (
                    <tr key={config.id} className="border-b border-neutral-100 last:border-b-0">
                      <td className="px-4 py-3 font-medium text-neutral-900">{config.label}</td>
                      <td className="px-4 py-3 text-neutral-700">{config.provider}</td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">{config.model}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">
                        {credentialLabel ?? '—'} {credentialLast4 ? <span>(…{credentialLast4})</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        {config.isDefault ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Default
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <ConfigActions id={config.id} isDefault={config.isDefault} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        );
      })}

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-medium">Add a config</h2>
        <AddConfigForm credentials={credentials} />
      </section>
    </div>
  );
}
