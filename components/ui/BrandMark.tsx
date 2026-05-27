/**
 * red5 / capture wordmark.
 *
 * `subtle` variant ("Published by red5") is used as a foot attribution.
 * Default variant ("capture · by red5") is used in headers / sign-in.
 */
export function BrandMark({ subtle = false }: { subtle?: boolean }) {
  if (subtle) {
    return (
      <div className="brand-sm">
        Published by <span className="b-strong">red5</span>
      </div>
    );
  }
  return (
    <div className="brand">
      <span className="brand-dot" aria-hidden />
      <span>
        capture <span className="text-ink-4 mx-1">·</span>
        <span className="text-ink-3 font-medium">by red5</span>
      </span>
    </div>
  );
}
