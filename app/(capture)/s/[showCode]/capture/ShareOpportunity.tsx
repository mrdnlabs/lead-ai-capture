'use client';

import { useEffect, useState } from 'react';

interface Props {
  showSlug: string;
  opportunityCode: string;
}

export function ShareOpportunity({ showSlug, opportunityCode }: Props) {
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShareUrl(`${window.location.origin}/s/${showSlug}/capture?opp=${opportunityCode}`);
  }, [showSlug, opportunityCode]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-medium"
      >
        <span>Share opportunity with another phone</span>
        <span className="text-xs text-neutral-500">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-xs text-neutral-500">
            Anyone signed in to this show, on the same opportunity code, contributes captures to
            the same lead. Open this URL on the other phone:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={copy}
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="pt-1 text-xs text-neutral-500">
            Code <code className="font-mono text-neutral-900">{opportunityCode}</code>
          </div>
        </div>
      ) : null}
    </section>
  );
}
