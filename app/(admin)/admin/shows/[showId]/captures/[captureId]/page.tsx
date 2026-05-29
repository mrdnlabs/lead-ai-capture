export const dynamic = 'force-dynamic';

import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { captureExtractions, captures, leads, reps, shows } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/currentRep';
import { AUDIO_BUCKET, PHOTO_BUCKET, signedDownloadUrl } from '@/lib/storage/server';

interface Params {
  params: Promise<{ showId: string; captureId: string }>;
}

function fmtMs(ms?: number) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(s: string | null): string {
  if (!s) return '—';
  const n = parseFloat(s);
  if (Number.isNaN(n)) return '—';
  if (n < 0.001) return '<$0.001';
  return `$${n.toFixed(4)}`;
}

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Mint a signed URL for a stored blob, swallowing errors (a missing object
 *  shouldn't 500 the whole review page — we just show "unavailable"). */
async function safeSignedUrl(bucket: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await signedDownloadUrl({ bucket, key, expiresInSeconds: 3600 });
  } catch {
    return null;
  }
}

export default async function CaptureReviewPage({ params }: Params) {
  await requireAdmin();
  const { showId, captureId } = await params;

  const [capture] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
  // Cross-show guard: an admin can only reach a capture through its own show's
  // list. If the id belongs to a different show (or doesn't exist), bounce.
  if (!capture || capture.showId !== showId) {
    redirect(`/admin/shows/${showId}/captures`);
  }

  const [[show], [rep], extractions, [lead]] = await Promise.all([
    db.select().from(shows).where(eq(shows.id, showId)).limit(1),
    db.select().from(reps).where(eq(reps.id, capture.repId)).limit(1),
    db
      .select()
      .from(captureExtractions)
      .where(eq(captureExtractions.captureId, captureId))
      .orderBy(desc(captureExtractions.processedAt)),
    db.select().from(leads).where(eq(leads.opportunityId, capture.opportunityId)).limit(1),
  ]);

  const [audioUrl, photoUrl] = await Promise.all([
    safeSignedUrl(AUDIO_BUCKET, capture.audioBlobKey),
    safeSignedUrl(PHOTO_BUCKET, capture.photoBlobKey),
  ]);

  const transcript = capture.realtimeTranscript ?? [];
  const liveFields = capture.liveFields ?? {};
  const mergedFields = (lead?.mergedFields ?? {}) as Record<string, unknown>;
  const confidence = (lead?.confidenceScores ?? {}) as Record<string, number>;
  const missingFields = (lead?.missingFields ?? []) as string[];

  return (
    <div className="space-y-6">
      <header>
        <a
          href={`/admin/shows/${showId}/captures`}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          ← {show?.name ?? 'Show'} · captures
        </a>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
          <span className="font-mono text-base text-neutral-500">{capture.id.slice(0, 8)}</span>
          Capture review
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
          <span>{rep?.email ?? 'unknown rep'}</span>
          <span>·</span>
          <span>{new Date(capture.serverReceivedAt).toLocaleString()}</span>
          <span>·</span>
          <span>duration {fmtDuration(capture.durationMs)}</span>
          <span>·</span>
          <span>status {capture.status}</span>
          {capture.hadRealtimeAssist ? (
            <>
              <span>·</span>
              <span className="font-medium text-neutral-700">AI assist on</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT — raw inputs */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Raw inputs · source of truth
          </h2>

          {/* Audio */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">Audio recording</div>
            {audioUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls preload="metadata" src={audioUrl} className="w-full" />
            ) : (
              <div className="text-sm text-neutral-400">
                {capture.audioBlobKey ? 'Audio unavailable (signed URL failed).' : 'No audio on this capture.'}
              </div>
            )}
          </section>

          {/* Photo */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">Badge / card photo</div>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Captured badge or business card"
                className="max-h-[420px] w-auto rounded-md border border-neutral-200"
              />
            ) : (
              <div className="text-sm text-neutral-400">
                {capture.photoBlobKey ? 'Photo unavailable (signed URL failed).' : 'No photo on this capture.'}
              </div>
            )}
          </section>

          {/* Live conversation */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">
              Live conversation ({transcript.length} turns)
            </div>
            {transcript.length === 0 ? (
              <div className="text-sm text-neutral-400">No live AI conversation recorded.</div>
            ) : (
              <div className="space-y-2">
                {transcript.map((t, i) => {
                  const role = typeof t.role === 'string' ? t.role : 'unknown';
                  const text = typeof t.text === 'string' ? t.text : JSON.stringify(t);
                  const isUser = role === 'user';
                  return (
                    <div
                      key={i}
                      className={
                        'rounded-md px-3 py-2 text-sm ' +
                        (isUser
                          ? 'bg-neutral-100 text-neutral-800'
                          : 'bg-blue-50 text-blue-900')
                      }
                    >
                      <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                        {isUser ? 'rep' : 'ai'}
                      </span>
                      {text}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Live fields */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">
              Fields captured live (during the session)
            </div>
            {Object.keys(liveFields).length === 0 ? (
              <div className="text-sm text-neutral-400">No fields captured live.</div>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(liveFields).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-xs text-neutral-500">{k}</dt>
                    <dd className="text-neutral-800">
                      {v.value}
                      {typeof v.confidence === 'number' ? (
                        <span className="ml-2 text-xs text-neutral-400">
                          ({Math.round(v.confidence * 100)}%)
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        {/* RIGHT — AI output */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            AI output · what landed
          </h2>

          {/* Merged lead */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">
              Merged lead record (what exports to CSV)
            </div>
            {Object.keys(mergedFields).length === 0 ? (
              <div className="text-sm text-neutral-400">No lead record yet.</div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(mergedFields).map(([k, v]) => (
                    <tr key={k} className="border-b border-neutral-100 last:border-b-0">
                      <td className="py-1.5 pr-3 font-mono text-xs text-neutral-500 align-top">{k}</td>
                      <td className="py-1.5 pr-3 text-neutral-800">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </td>
                      <td className="py-1.5 text-right text-xs text-neutral-400 align-top">
                        {typeof confidence[k] === 'number' ? `${Math.round(confidence[k] * 100)}%` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {missingFields.length > 0 ? (
              <div className="mt-3 text-xs text-neutral-500">
                <span className="font-medium text-amber-700">Missing:</span> {missingFields.join(', ')}
              </div>
            ) : null}
          </section>

          {/* Post-processing extractions */}
          <section className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 text-xs font-medium text-neutral-600">
              Post-processing extraction{extractions.length === 1 ? '' : 's'} ({extractions.length})
            </div>
            {extractions.length === 0 ? (
              <div className="text-sm text-neutral-400">
                No extraction yet — capture may still be processing.
              </div>
            ) : (
              <div className="space-y-3">
                {extractions.map((e) => {
                  const versions = (e.modelVersions ?? {}) as Record<string, string>;
                  const latencies = (e.latencyMs ?? {}) as Record<string, number>;
                  const isShadow = versions?.mode === 'shadow';
                  return (
                    <div
                      key={e.id}
                      className={
                        'rounded border p-3 text-xs ' +
                        (isShadow ? 'border-amber-200 bg-amber-50' : 'border-neutral-200')
                      }
                    >
                      <div className="font-medium">
                        {isShadow ? '⏵ shadow ' : '⏵ primary '}
                        {Object.entries(versions)
                          .filter(([k]) => k !== 'mode')
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ') || 'no model'}
                      </div>
                      <div className="mt-1 text-neutral-600">
                        latency:{' '}
                        {Object.entries(latencies)
                          .map(([k, v]) => `${k}=${fmtMs(v)}`)
                          .join(', ') || '—'}{' '}
                        · cost: {fmtCost(e.costEstimateUsd)}
                      </div>
                      {e.transcript ? (
                        <div className="mt-2 italic text-neutral-700">“{e.transcript}”</div>
                      ) : null}
                      <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-neutral-600">
                        {JSON.stringify(
                          {
                            ...(Object.keys(e.badgeFields ?? {}).length > 0
                              ? { badge: e.badgeFields }
                              : {}),
                            ...(Object.keys(e.extractedFields ?? {}).length > 0
                              ? { transcript: e.extractedFields }
                              : {}),
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
