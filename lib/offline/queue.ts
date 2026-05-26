'use client';

import { getDexie, type OutboxItem } from '@/lib/db/dexie';

export interface QueuedCaptureInput {
  showSlug: string;
  opportunityCode: string;
  clientCapturedAt: string;
  durationMs?: number;
  photoBlob?: Blob;
  audioBlob?: Blob;
}

export async function enqueueCapture(input: QueuedCaptureInput): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
    ...input,
  };
  await getDexie().outbox.put(item);
  notifyQueueChanged();
  return item;
}

export async function queueCount(): Promise<number> {
  return getDexie().outbox.count();
}

export async function listQueued(): Promise<OutboxItem[]> {
  return getDexie().outbox.orderBy('queuedAt').toArray();
}

export async function uploadOne(item: OutboxItem): Promise<void> {
  const form = new FormData();
  form.set('showSlug', item.showSlug);
  form.set('opportunityCode', item.opportunityCode);
  form.set('idempotencyKey', item.idempotencyKey);
  form.set('clientCapturedAt', item.clientCapturedAt);
  if (item.durationMs != null) form.set('durationMs', String(item.durationMs));
  if (item.photoBlob) {
    const ext =
      item.photoBlob.type.includes('jpeg') || item.photoBlob.type.includes('jpg')
        ? 'jpg'
        : item.photoBlob.type.includes('png')
          ? 'png'
          : 'photo';
    form.set(
      'photo',
      new File([item.photoBlob], `photo.${ext}`, { type: item.photoBlob.type || 'image/jpeg' }),
    );
  }
  if (item.audioBlob) {
    const ext = item.audioBlob.type.includes('webm')
      ? 'webm'
      : item.audioBlob.type.includes('mp4')
        ? 'm4a'
        : 'audio';
    form.set(
      'audio',
      new File([item.audioBlob], `audio.${ext}`, { type: item.audioBlob.type || 'audio/webm' }),
    );
  }
  const res = await fetch('/api/captures', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
}

export interface DrainResult {
  uploaded: number;
  failed: number;
  remaining: number;
}

export async function drainQueue(): Promise<DrainResult> {
  const items = await listQueued();
  let uploaded = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await uploadOne(item);
      await getDexie().outbox.delete(item.id);
      uploaded++;
      notifyQueueChanged();
    } catch (e) {
      await getDexie().outbox.update(item.id, {
        attempts: (item.attempts ?? 0) + 1,
        lastAttemptAt: Date.now(),
        lastError: (e as Error).message,
      });
      failed++;
    }
  }
  return { uploaded, failed, remaining: await queueCount() };
}

// Lightweight pub/sub for UI to refresh on queue changes.
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeQueueChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyQueueChanged() {
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

// Wire up auto-drain when going online or returning to the tab.
let autoDrainRegistered = false;
export function registerAutoDrain() {
  if (autoDrainRegistered || typeof window === 'undefined') return;
  autoDrainRegistered = true;
  const tryDrain = async () => {
    if (!navigator.onLine) return;
    const count = await queueCount();
    if (count === 0) return;
    await drainQueue();
  };
  window.addEventListener('online', tryDrain);
  window.addEventListener('focus', tryDrain);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tryDrain();
  });
}
