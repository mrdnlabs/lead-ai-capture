/**
 * Renders the show's color swatch + badge text used in cards and pills.
 * Variant is deterministic from the show slug — same show always looks the
 * same across screens.
 */

function variant(slug: string): '' | 'alt-1' | 'alt-2' {
  // Hash slug to one of three swatch styles (default red, dark, paper-3).
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  const n = Math.abs(h) % 3;
  if (n === 1) return 'alt-1';
  if (n === 2) return 'alt-2';
  return '';
}

function initials(name: string): string {
  // Two-letter monogram from the name, e.g. "Tech Summit 2026" → "TS"
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ShowSwatch({
  slug,
  name,
  size = 'md',
}: {
  slug: string;
  name: string;
  size?: 'xs' | 'md';
}) {
  const v = variant(slug);
  const cls = size === 'xs' ? `swatch-xs ${v}` : `swatch ${v}`.trim();
  return <div className={cls}>{initials(name)}</div>;
}
