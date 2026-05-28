import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  captureExtractions,
  captures,
  providerConfigs,
  reps,
  shows,
} from '@/db/schema';

function fmtMs(ms?: number) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(s: string | null): string {
  if (!s) return '—';
  const n = parseFloat(s);
  if (Number.isNaN(n)) return '—';
  if (n < 0.001) return `<$0.001`;
  return `$${n.toFixed(4)}`;
}

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  // Aggregate: extractions joined to captures + their provider config + show
  const rows = await db
    .select({
      extraction: captureExtractions,
      capture: captures,
      show: shows,
      rep: reps,
      config: providerConfigs,
    })
    .from(captureExtractions)
    .leftJoin(captures, eq(captures.id, captureExtractions.captureId))
    .leftJoin(shows, eq(shows.id, captures.showId))
    .leftJoin(reps, eq(reps.id, captures.repId))
    .leftJoin(
      providerConfigs,
      eq(providerConfigs.id, captureExtractions.transcriptionProviderConfigId),
    )
    .orderBy(desc(captureExtractions.processedAt))
    .limit(100);

  // Aggregated stats per provider config (latency mean, total cost, count)
  const stats = await db
    .select({
      configId: captureExtractions.transcriptionProviderConfigId,
      count: sql<number>`count(*)::int`,
      totalCost: sql<string>`coalesce(sum(${captureExtractions.costEstimateUsd}), 0)::text`,
    })
    .from(captureExtractions)
    .groupBy(captureExtractions.transcriptionProviderConfigId);

  const configsById = new Map(
    (await db.select().from(providerConfigs)).map((c) => [c.id, c]),
  );

  // Group extractions by capture for side-by-side view
  type ExtractionRow = (typeof rows)[number];
  const byCapture = new Map<string, ExtractionRow[]>();
  for (const row of rows) {
    if (!row.capture) continue;
    const arr = byCapture.get(row.capture.id) ?? [];
    arr.push(row);
    byCapture.set(row.capture.id, arr);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Per-provider extraction counts, costs, and side-by-side comparison when A/B assignments
          are active.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 overflow-x-auto">
        <header className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
          <h2 className="text-sm font-medium">Per-provider rollup</h2>
        </header>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2">Config</th>
              <th className="px-4 py-2">Extractions</th>
              <th className="px-4 py-2">Total cost (est.)</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-neutral-400" colSpan={3}>
                  No extractions yet.
                </td>
              </tr>
            ) : (
              stats.map((s) => {
                const cfg = s.configId ? configsById.get(s.configId) : null;
                return (
                  <tr key={s.configId ?? '-'} className="border-t border-neutral-100">
                    <td className="px-4 py-2">
                      {cfg ? `${cfg.provider}/${cfg.model} (${cfg.label})` : '(no transcription config)'}
                    </td>
                    <td className="px-4 py-2">{s.count}</td>
                    <td className="px-4 py-2">{fmtCost(s.totalCost)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-neutral-200">
        <header className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
          <h2 className="text-sm font-medium">Recent captures</h2>
        </header>
        <div className="divide-y divide-neutral-100">
          {[...byCapture.entries()].slice(0, 30).map(([capId, exts]) => {
            const first = exts[0];
            const cap = first.capture!;
            return (
              <div key={capId} className="px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-xs text-neutral-500">{capId.slice(0, 8)}</div>
                  <div className="text-xs text-neutral-500">
                    {first.show?.name} · {first.rep?.email} ·{' '}
                    {new Date(cap.serverReceivedAt).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {exts.map((e) => {
                    const versions = e.extraction.modelVersions as Record<string, string>;
                    const latencies = e.extraction.latencyMs as Record<string, number>;
                    const isShadow = versions?.mode === 'shadow';
                    return (
                      <div
                        key={e.extraction.id}
                        className={
                          'rounded border p-2 text-xs ' +
                          (isShadow ? 'border-amber-200 bg-amber-50' : 'border-neutral-200')
                        }
                      >
                        <div className="font-medium">
                          {isShadow ? '⏵ shadow ' : '⏵ primary '}
                          {Object.entries(versions ?? {})
                            .filter(([k]) => k !== 'mode')
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(', ') || 'no model'}
                        </div>
                        <div className="mt-1 text-neutral-600">
                          latency:{' '}
                          {Object.entries(latencies ?? {})
                            .map(([k, v]) => `${k}=${fmtMs(v)}`)
                            .join(', ') || '—'}{' '}
                          · cost: {fmtCost(e.extraction.costEstimateUsd)}
                        </div>
                        {e.extraction.transcript ? (
                          <div className="mt-1 italic text-neutral-700">
                            “{e.extraction.transcript.slice(0, 150)}{e.extraction.transcript.length > 150 ? '…' : ''}”
                          </div>
                        ) : null}
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-neutral-600">
                          {JSON.stringify({
                            ...(Object.keys(e.extraction.badgeFields ?? {}).length > 0
                              ? { badge: e.extraction.badgeFields }
                              : {}),
                            ...(Object.keys(e.extraction.extractedFields ?? {}).length > 0
                              ? { transcript: e.extraction.extractedFields }
                              : {}),
                          }, null, 2)}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
