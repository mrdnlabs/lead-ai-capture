'use client';

import { useEffect, useState } from 'react';
import { Check, CloudOff, Sparkles } from 'lucide-react';
import { subscribeToasts, type ToastPayload } from '@/lib/ui/toast';

/**
 * Mounted once in app/layout.tsx. Subscribes to toast events and renders
 * the active toasts in a fixed-bottom stack. Auto-dismisses after each
 * toast's `durationMs` (default 3200ms).
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastPayload[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      setToasts((cur) => [...cur, t]);
      const duration = t.durationMs ?? 3200;
      if (duration > 0) {
        window.setTimeout(() => {
          setToasts((cur) => cur.filter((x) => x.id !== t.id));
        }, duration);
      }
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span aria-hidden className="flex-shrink-0">
            {t.kind === 'ok' ? (
              <Check size={18} />
            ) : t.kind === 'accent' ? (
              <Sparkles size={18} />
            ) : (
              <CloudOff size={18} />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">{t.title}</div>
            {t.meta ? <div className="text-xs opacity-80 mt-0.5">{t.meta}</div> : null}
          </div>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                setToasts((cur) => cur.filter((x) => x.id !== t.id));
              }}
              className="h-7 px-2.5 rounded-md text-xs font-semibold border border-current opacity-90 hover:opacity-100"
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
