/**
 * Opportunity code displayed in monospace + uppercase + letter-spaced,
 * so reps can read it aloud. Per design brief § 9.
 */
export function OpCode({
  code,
  size = 'md',
  className = '',
}: {
  code: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const base = size === 'lg' ? 'op-code-lg' : 'op-code';
  return <span className={`${base} ${className}`.trim()}>{code}</span>;
}
