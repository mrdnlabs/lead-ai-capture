'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { drainQueue, listQueued, subscribeQueueChanges } from '@/lib/offline/queue';
import type { OutboxItem } from '@/lib/db/dexie';

interface QueueSheetProps {
  open: boolean;
  onClose: () => void;
}

function formatAge(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function QueueSheet({ open, onClose }: QueueSheetProps) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [draining, setDraining] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    void listQueued().then(setItems);
    return subscribeQueueChanges(() => {
      void listQueued().then(setItems);
    });
  }, [open]);

  async function retry() {
    setDraining(true);
    try {
      await drainQueue();
      setLastSyncAt(Date.now());
      setItems(await listQueued());
    } finally {
      setDraining(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Outbox"
      subtitle="Captures upload in the background. You can keep working."
      foot={
        <div className="t-tiny text-center">
          {draining
            ? 'Syncing…'
            : items.length === 0
              ? 'All caught up.'
              : `Auto-retry on reconnect${lastSyncAt ? ` · last sync ${formatAge(lastSyncAt)}` : ''}`}
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="t-meta px-3 py-6 text-center">No captures waiting to upload.</div>
      ) : (
        items.map((item) => {
          const kind = item.attempts > 0 ? 'is-failed' : 'is-queued';
          return (
            <div key={item.id} className={`q-row ${kind}`}>
              <span className="dot" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  {item.opportunityCode || 'new lead'}
                  <span className="ml-2 t-tiny font-normal">
                    {formatAge(item.queuedAt)}
                  </span>
                </div>
                <div className="t-tiny mt-0.5">
                  {item.lastError
                    ? `Upload failed · ${item.lastError.slice(0, 80)}`
                    : 'waiting · will upload when online'}
                </div>
              </div>
              {item.lastError ? (
                <button
                  type="button"
                  onClick={retry}
                  className="h-7 px-2.5 rounded-md text-xs font-semibold border border-rule-2 bg-surface text-ink-2"
                >
                  Retry
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </Sheet>
  );
}
