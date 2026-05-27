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

class AiCaptureDb extends Dexie {
  outbox!: Table<OutboxItem, string>;
  constructor() {
    super('ai-capture');
    this.version(1).stores({
      outbox: 'id, queuedAt, opportunityCode',
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
