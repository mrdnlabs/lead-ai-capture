'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional sub-copy under the title. */
  subtitle?: string;
  /** Sheet body — typically a scrollable list. */
  children: React.ReactNode;
  /** Optional sticky foot — e.g. a "+ Invite" action. */
  foot?: React.ReactNode;
}

/**
 * Generic bottom-anchored modal scaffold.
 *
 * - Backdrop fades in, sheet slides up.
 * - Tap backdrop to close; ESC also closes.
 * - Renders to a portal on `document.body` so it layers above route content.
 * - Locks body scroll while open.
 */
export function Sheet({ open, onClose, title, subtitle, children, foot }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="sheet-host"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" aria-hidden />
        <div className="sheet-hd">
          <div className="min-w-0 flex-1">
            <h2>{title}</h2>
            {subtitle ? <div className="t-tiny mt-1">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-3 hover:bg-paper-2"
          >
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot ? <div className="pt-3">{foot}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
