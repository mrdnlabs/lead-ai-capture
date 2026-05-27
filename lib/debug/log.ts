'use client';

import { getDexie, type DebugLogEntry } from '@/lib/db/dexie';

const STORAGE_KEY = 'aicapture.debug';
const MAX_PAYLOAD_CHARS = 8000;
const MAX_ENTRIES = 2000;

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Append a row to the debug log. No-op when debug is off, so callers can
 * sprinkle this in hot paths without paying a cost in production.
 *
 * Audio chunks are summarized — we store the size/MIME instead of the base64
 * payload, otherwise a 60-second session balloons the IndexedDB to hundreds
 * of megabytes.
 */
export function logDebug(
  sessionId: string,
  direction: DebugLogEntry['direction'],
  kind: string,
  payload: unknown,
): void {
  if (!isDebugEnabled()) return;

  let serialized: string;
  try {
    serialized = summarizePayload(payload);
  } catch {
    serialized = '<<unserializable>>';
  }
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    serialized = serialized.slice(0, MAX_PAYLOAD_CHARS) + '…(truncated)';
  }

  // Fire-and-forget; we don't want logging to block the WSS event loop.
  void getDexie()
    .debugLog.add({
      at: Date.now(),
      sessionId,
      direction,
      kind,
      payload: serialized,
    })
    .then(() => trimIfTooLarge())
    .catch(() => {
      /* Dexie errors are non-fatal for the app */
    });
}

function summarizePayload(payload: unknown): string {
  if (payload == null) return 'null';
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') return String(payload);

  // Replace fat base64 audio/video data with a summary so the log stays small.
  const cleaned = JSON.parse(
    JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'string' && value.length > 1024) {
        return `<<${value.length} chars elided>>`;
      }
      return value;
    }),
  );
  return JSON.stringify(cleaned);
}

async function trimIfTooLarge(): Promise<void> {
  const db = getDexie();
  const count = await db.debugLog.count();
  if (count <= MAX_ENTRIES) return;
  // Drop the oldest excess entries.
  const excess = count - MAX_ENTRIES;
  const oldest = await db.debugLog.orderBy('at').limit(excess).primaryKeys();
  await db.debugLog.bulkDelete(oldest);
}

export async function clearDebugLog(): Promise<void> {
  await getDexie().debugLog.clear();
}

export async function exportDebugLog(): Promise<DebugLogEntry[]> {
  return getDexie().debugLog.orderBy('at').toArray();
}
