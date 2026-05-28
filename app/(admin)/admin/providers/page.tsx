export const dynamic = 'force-dynamic';

import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { providerCredentials } from '@/db/schema';
import { listAvailableFallbacks } from '@/lib/providers/fallback';
import { AddCredentialForm } from './AddCredentialForm';
import { CredentialActions } from './CredentialRow';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  google_stt: 'Google STT',
  deepgram: 'Deepgram',
  anthropic: 'Anthropic',
};

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

export default async function ProvidersPage() {
  const creds = await db
    .select()
    .from(providerCredentials)
    .orderBy(desc(providerCredentials.createdAt));
  const fallbacks = listAvailableFallbacks();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Provider credentials</h1>
        <p className="mt-1 text-sm text-neutral-500">
          API keys for AI providers. Encrypted at rest with AES-256-GCM; never visible after
          creation. Mobile clients never see the raw key — they receive short-lived ephemeral
          tokens minted server-side per session.
        </p>
      </header>

      {fallbacks.length > 0 ? (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="font-medium text-blue-900">Server defaults active</div>
          <div className="mt-1 text-blue-800">
            When no admin-configured credential exists for a provider, the app falls back to
            server-side env keys. Currently active fallbacks:{' '}
            {fallbacks.map((f, i) => (
              <span key={f.kind}>
                {i > 0 && ', '}
                <code className="font-mono">{f.kind}</code> → {f.provider}/{f.model}
              </span>
            ))}
            . Add a credential below to override.
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-neutral-200 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Last used</th>
              <th className="px-4 py-2 font-medium">Uses</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {creds.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  No credentials yet. Add one below.
                </td>
              </tr>
            ) : (
              creds.map((c) => (
                <tr key={c.id} className="border-b border-neutral-100 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    {PROVIDER_LABELS[c.provider] ?? c.provider}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{c.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    …{c.last4} <span className="text-neutral-300">·</span> KEK {c.encryptionKeyId}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{fmtDate(c.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-neutral-700">{c.useCount}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.isActive
                          ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                          : 'inline-flex rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600'
                      }
                    >
                      {c.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CredentialActions id={c.id} isActive={c.isActive} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-medium">Add a new credential</h2>
        <AddCredentialForm />
      </section>
    </div>
  );
}
