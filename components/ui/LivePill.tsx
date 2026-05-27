/**
 * Small pulsing "Live" indicator. Used in show cards (today) and live timer.
 */
export function LivePill({ label = 'Live' }: { label?: string }) {
  return (
    <span className="pill pill-live">
      <span className="dot" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
