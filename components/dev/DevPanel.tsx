'use client';

import { useEffect, useState } from 'react';
import { isDebugEnabled, setDebugEnabled } from '@/lib/debug/log';

interface DevPanelProps {
  simulatedOffline: boolean;
  setSimulatedOffline: (v: boolean) => void;
}

/**
 * Floating dev-only panel for the capture surface. Hidden by default.
 * Mount only when ?dev=1 is in the URL (the parent gates rendering).
 *
 * Houses the two testing toggles that used to clutter the production
 * capture screen: "Simulate offline" and "Debug mode".
 */
export function DevPanel({ simulatedOffline, setSimulatedOffline }: DevPanelProps) {
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => setDebugMode(isDebugEnabled()), []);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-64 rounded-2xl border border-rule-2 bg-surface p-3 shadow-2 text-sm">
      <div className="t-eyebrow mb-2">Dev panel</div>

      <label className="flex cursor-pointer items-start gap-2 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={simulatedOffline}
          onChange={(e) => setSimulatedOffline(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-ink">Simulate offline</span>
          <div className="t-tiny mt-0.5">Force submit into the Dexie queue.</div>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={debugMode}
          onChange={(e) => {
            setDebugEnabled(e.target.checked);
            setDebugMode(e.target.checked);
          }}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-ink">Debug mode</span>
          <div className="t-tiny mt-0.5">
            Archive raw AI traffic locally.{' '}
            <a href="/debug/log" className="underline">
              view log
            </a>
          </div>
        </span>
      </label>
    </div>
  );
}
