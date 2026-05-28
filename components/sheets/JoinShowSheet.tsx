'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ExternalLink } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';

interface JoinShowSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Extract the invite token from either:
 *   - a full URL like https://…/join/abc123 (any host)
 *   - or a raw token string (16+ URL-safe chars)
 *  Returns null if nothing parses cleanly. */
function parseInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/join\/([A-Za-z0-9_-]+)/);
  if (urlMatch && urlMatch[1].length >= 16) return urlMatch[1];
  // Bare-token paste: must look like a base64url-ish token.
  if (/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) return trimmed;
  return null;
}

/** True when the current browser exposes window.BarcodeDetector (Chrome
 *  Android, Edge, recent Chromium). Used to render the camera affordance
 *  only when we can actually decode the QR client-side. */
function hasBarcodeDetector(): boolean {
  if (typeof window === 'undefined') return false;
  return 'BarcodeDetector' in window;
}

/**
 * Modal for redeeming a show-invite link from inside the PWA.
 *
 * Always available: paste the URL / token into a textarea, tap Open.
 * Camera-available (BarcodeDetector present): tap Scan, OS camera opens
 *   via a hidden file input, we decode the resulting image and navigate.
 * iOS Safari (no BarcodeDetector yet): the camera button is hidden and a
 *   small hint nudges the rep to paste instead.
 */
export function JoinShowSheet({ open, onClose }: JoinShowSheetProps) {
  const router = useRouter();
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Stable across renders so we don't flicker the camera button on hydration.
  const supportsCamera = hasBarcodeDetector();

  const parsedToken = parseInviteToken(pasteValue);

  function go(token: string) {
    setError(null);
    setPasteValue('');
    onClose();
    router.push(`/join/${encodeURIComponent(token)}`);
  }

  function onPasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsedToken) {
      setError("That doesn't look like an invite link. Paste the full URL.");
      return;
    }
    go(parsedToken);
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      // BarcodeDetector is loaded lazily — feature-detected above.
      const Detector = (window as unknown as {
        BarcodeDetector: new (opts: { formats: string[] }) => {
          detect: (src: ImageBitmap) => Promise<Array<{ rawValue: string }>>;
        };
      }).BarcodeDetector;
      const detector = new Detector({ formats: ['qr_code'] });
      const results = await detector.detect(bitmap);
      bitmap.close?.();
      const raw = results[0]?.rawValue ?? '';
      const token = parseInviteToken(raw);
      if (!token) {
        setError("Couldn't read an invite from that photo. Try again or paste the URL.");
        return;
      }
      go(token);
    } catch (err) {
      setError(`Camera scan failed: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Join a show"
      subtitle="Get added to a show by redeeming an invite link from your booth lead."
    >
      <form onSubmit={onPasteSubmit} className="space-y-2.5">
        <label htmlFor="join-paste" className="t-eyebrow block">
          Invite link
        </label>
        <textarea
          id="join-paste"
          value={pasteValue}
          onChange={(e) => {
            setPasteValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="https://ai-capture.vercel.app/join/…"
          autoFocus
          rows={2}
          className="input w-full font-mono text-[13px]"
          style={{ minHeight: 64, resize: 'none' }}
        />
        <button
          type="submit"
          disabled={!parsedToken}
          className="btn btn-primary w-full"
        >
          <ExternalLink size={16} />
          Open invite
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-ink-4">
        <div className="flex-1 h-px bg-rule" />
        <div className="t-tiny">or</div>
        <div className="flex-1 h-px bg-rule" />
      </div>

      {supportsCamera ? (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning}
            className="btn btn-sub w-full"
          >
            <Camera size={16} />
            {scanning ? 'Reading…' : 'Scan with camera'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChosen}
            style={{ display: 'none' }}
          />
        </>
      ) : (
        <div className="card-flat text-[13px] text-ink-3">
          <strong className="text-ink-2">On iPhone?</strong> Camera-scan isn't supported in
          Safari yet. Paste the invite URL above — your booth lead can text or AirDrop it to
          you.
        </div>
      )}

      {error ? <div className="mt-3 t-tiny text-warn">{error}</div> : null}
    </Sheet>
  );
}
