'use client';

import { useEffect, useState, useTransition } from 'react';
import { drainQueue, queueCount, registerAutoDrain, subscribeQueueChanges } from '@/lib/offline/queue';

export function QueuePill() {
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    registerAutoDrain();
    const refresh = async () => {
      try {
        setCount(await queueCount());
      } catch {
        /* dexie not available */
      }
    };
    void refresh();
    const unsub = subscribeQueueChanges(() => void refresh());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = setInterval(refresh, 5000);
    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  function syncNow() {
    startTransition(async () => {
      const r = await drainQueue();
      setLastResult(`${r.uploaded} uploaded, ${r.failed} failed`);
      setCount(r.remaining);
      setTimeout(() => setLastResult(null), 4000);
    });
  }

  if (count === 0 && online && !lastResult) return null;

  return (
    <button
      type="button"
      onClick={syncNow}
      disabled={pending || count === 0}
      className={
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ' +
        (online
          ? 'border-amber-300 bg-amber-50 text-amber-800'
          : 'border-neutral-300 bg-neutral-100 text-neutral-700')
      }
    >
      <span
        className={
          'inline-block h-2 w-2 rounded-full ' + (online ? 'bg-amber-500' : 'bg-neutral-400')
        }
      />
      {pending ? 'Syncing…' : lastResult ?? `${count} queued${online ? ' — tap to sync' : ' · offline'}`}
    </button>
  );
}
