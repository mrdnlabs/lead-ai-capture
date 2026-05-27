import Dexie, { type Table } from 'dexie';

export interface OutboxItem {
  id: string;
  showSlug: string;
  opportunityCode?: string;
  idempotencyKey: string;
  clientCapturedAt: string;
  durationMs?: number;
  photoBlob?: Blob;
  audioBlob?: Blob;
  realtimeTranscript?: Array<{ role: 'user' | 'assistant'; text: string; at: number }>;
  liveFields?: Record<string, { value: string; confidence?: number; at: number }>;
  queuedAt: number;
  lastAttemptAt?: number;
  attempts: number;
  lastError?: string;
}

/** Raw WSS message log — written only when debug mode is enabled. */
export interface DebugLogEntry {
  id?: number;
  at: number;
  sessionId: string;
  direction: 'send' | 'recv' | 'event';
  /** Lightweight summary for quick scanning (e.g. "audio chunk", "set_lead_field"). */
  kind: string;
  /** JSON-stringified payload (audio chunks are summarized, not stored whole). */
  payload: string;
}

class AiCaptureDb extends Dexie {
  outbox!: Table<OutboxItem, string>;
  debugLog!: Table<DebugLogEntry, number>;
  constructor() {
    super('ai-capture');
    this.version(1).stores({
      outbox: 'id, queuedAt, opportunityCode',
    });
    // v2 adds the debugLog table — Dexie handles the migration on open.
    this.version(2).stores({
      outbox: 'id, queuedAt, opportunityCode',
      debugLog: '++id, at, sessionId, direction',
    });
  }
}

let _db: AiCaptureDb | null = null;
export function getDexie(): AiCaptureDb {
  if (typeof window === 'undefined') {
    throw new Error('Dexie can only be used in the browser');
  }
  if (!_db) _db = new AiCaptureDb();
  return _db;
}
