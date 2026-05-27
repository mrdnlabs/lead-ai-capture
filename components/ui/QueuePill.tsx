'use client';

import { Cloud, CloudOff, Loader } from 'lucide-react';

/**
 * Header sync indicator. Three states:
 *  - synced:    paper pill + green dot (no count)
 *  - syncing N: live-wash pill + spinner + count
 *  - N queued:  warn-wash pill + cloud-off + count (tap to open QueueSheet)
 */
export function QueuePill({
  count = 0,
  syncing = 0,
  onClick,
}: {
  count?: number;
  syncing?: number;
  onClick?: () => void;
}) {
  if (syncing > 0) {
    return (
      <button type="button" className="pill pill-ai" onClick={onClick}>
        <Loader size={12} className="animate-[spin_0.9s_linear_infinite]" />
        <span>syncing {syncing}</span>
      </button>
    );
  }
  if (count > 0) {
    return (
      <button type="button" className="pill pill-warn" onClick={onClick}>
        <CloudOff size={12} />
        <span>{count} queued</span>
      </button>
    );
  }
  return (
    <span className="pill">
      <Cloud size={12} className="text-ok" />
      <span className="text-ink-3">synced</span>
    </span>
  );
}
