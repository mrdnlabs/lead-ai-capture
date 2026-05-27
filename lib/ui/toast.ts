'use client';

/**
 * Minimal pub/sub for cross-component toast firing.
 *
 * Any client component can `import { showToast } from '@/lib/ui/toast'` and
 * fire a toast without needing to thread props through a provider. The
 * `<ToastHost>` mounted in app/layout.tsx subscribes and renders the
 * active toast.
 */
export type ToastKind = 'ok' | 'accent' | 'offline';

export interface ToastPayload {
  id: string;
  kind: ToastKind;
  title: string;
  meta?: string;
  /** Optional action button (label + handler). */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after this many ms. Defaults to 3200. Pass 0 for sticky. */
  durationMs?: number;
}

type Listener = (t: ToastPayload) => void;
const listeners = new Set<Listener>();

export function showToast(p: Omit<ToastPayload, 'id'>): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const full: ToastPayload = { id, ...p };
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
