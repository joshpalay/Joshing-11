/**
 * Simple progress dots — filled = completed, hollow = remaining.
 */

export function GeometricProgress({
  total,
  current,
  results,
}: {
  total: number;
  current: number;
  results: Record<number, 'correct' | 'wrong' | 'expired'>;
}) {
  return (
    <div className="flex items-center gap-1.5 justify-center" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const pos = i + 1;
        const res = results[pos];
        const isCurrent = pos === current;
        const done = !!res;

        const dotColor = res === 'correct'
          ? 'var(--game-correct)'
          : res === 'wrong'
            ? 'var(--game-wrong-strong)'
            : res === 'expired'
              ? 'color-mix(in srgb, var(--text-muted) 60%, transparent)'
              : 'color-mix(in srgb, var(--text) 22%, transparent)';

        return (
          <span
            key={pos}
            style={{
              fontSize: isCurrent ? '0.95rem' : '0.75rem',
              lineHeight: 1,
              color: dotColor,
              opacity: isCurrent ? 1 : done ? 0.85 : 0.55,
            }}
          >
            {done ? '●' : '○'}
          </span>
        );
      })}
    </div>
  );
}
