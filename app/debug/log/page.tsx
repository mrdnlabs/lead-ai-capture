'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearDebugLog, exportDebugLog, isDebugEnabled } from '@/lib/debug/log';
import type { DebugLogEntry } from '@/lib/db/dexie';

export default function DebugLogPage() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    setEntries(await exportDebugLog());
  }, []);

  useEffect(() => {
    setEnabled(isDebugEnabled());
    void refresh();
  }, [refresh]);

  const filtered = filter
    ? entries.filter(
        (e) =>
          e.kind.toLowerCase().includes(filter.toLowerCase()) ||
          e.payload.toLowerCase().includes(filter.toLowerCase()) ||
          e.sessionId.toLowerCase().includes(filter.toLowerCase()),
      )
    : entries;

  const sessions = new Map<string, number>();
  for (const e of entries) sessions.set(e.sessionId, (sessions.get(e.sessionId) ?? 0) + 1);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aicapture-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold">Debug log</h1>
        <p className="text-xs text-neutral-600">
          Raw WSS traffic from realtime AI sessions, archived to this device&apos;s IndexedDB.
        </p>
        <p className="mt-1 text-xs">
          Debug mode is{' '}
          <span
            className={
              enabled ? 'font-medium text-purple-700' : 'font-medium text-neutral-500'
            }
          >
            {enabled ? 'ON' : 'OFF'}
          </span>{' '}
          (toggle from the capture page).
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by kind, session, or payload…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={downloadJson}
          disabled={entries.length === 0}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-30"
        >
          Download JSON
        </button>
        <button
          type="button"
          onClick={async () => {
            if (window.confirm(`Clear all ${entries.length} log entries?`)) {
              await clearDebugLog();
              await refresh();
            }
          }}
          disabled={entries.length === 0}
          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 disabled:opacity-30"
        >
          Clear
        </button>
      </div>

      <div className="text-xs text-neutral-500">
        {entries.length} entries · {sessions.size} sessions
        {filter ? ` · ${filtered.length} match filter` : ''}
      </div>

      <ul className="space-y-1">
        {filtered.length === 0 ? (
          <li className="rounded-md border border-dashed border-neutral-300 p-3 text-sm text-neutral-500">
            {enabled
              ? 'No entries yet — start a realtime session.'
              : 'Enable debug mode from the capture page, then start a session.'}
          </li>
        ) : (
          filtered.map((e) => (
            <li
              key={e.id}
              className={
                'rounded-md border p-2 font-mono text-[11px] leading-tight ' +
                (e.direction === 'send'
                  ? 'border-sky-200 bg-sky-50'
                  : e.direction === 'recv'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-neutral-200 bg-neutral-50')
              }
            >
              <div className="flex items-baseline gap-2 text-neutral-600">
                <span className="font-semibold uppercase">{e.direction}</span>
                <span>{e.kind}</span>
                <span className="ml-auto text-neutral-400">
                  {new Date(e.at).toLocaleTimeString()} · {e.sessionId.slice(0, 8)}
                </span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all text-neutral-800">
                {e.payload}
              </pre>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
