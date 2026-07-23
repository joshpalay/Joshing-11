/**
 * Daily Five progress dots (+ additive bonus).
 *
 * D-F1 / D-F1b: one continuous track — the core dots, then (only when there are
 * bonus questions) a visible separator, the bonus dots, and a generic
 * "+{N} friend bonus" label. The bonus signal is carried by the gap +
 * label (real text), never by color alone (canon R3); bonus dots reuse the same
 * state ramp as the core dots so answering reads identically.
 *
 * N=0 → exactly `coreCount` dots, no separator, no label — pixel-identical to
 * the pre-bonus track.
 *
 * `current`/`results` are positional across the whole track: positions
 * 1..coreCount are the core dots, coreCount+1..coreCount+bonusCount the bonus.
 */

type DotResult = 'correct' | 'wrong' | 'expired';

function dotColor(res: DotResult | undefined): string {
  return res === 'correct'
    ? 'var(--game-correct)'
    : res === 'wrong'
      ? 'var(--game-wrong-strong)'
      : res === 'expired'
        ? 'color-mix(in srgb, var(--text-muted) 60%, transparent)'
        : 'color-mix(in srgb, var(--text) 22%, transparent)';
}

function Dot({
  pos,
  current,
  results,
  ariaLabel,
}: {
  pos: number;
  current: number;
  results: Record<number, DotResult>;
  ariaLabel?: string;
}) {
  const res = results[pos];
  const isCurrent = pos === current;
  const done = !!res;
  return (
    <span
      // Core dots stay decorative (the count lives elsewhere); bonus dots carry
      // a real label so a screen reader can tell them apart from the core five.
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      style={{
        fontSize: isCurrent ? '0.95rem' : '0.75rem',
        lineHeight: 1,
        color: dotColor(res),
        opacity: isCurrent ? 1 : done ? 0.85 : 0.55,
      }}
    >
      {done ? '●' : '○'}
    </span>
  );
}

export function GeometricProgress({
  coreCount,
  bonusCount,
  current,
  results,
}: {
  coreCount: number;
  bonusCount: number;
  current: number;
  results: Record<number, DotResult>;
}) {
  const coreDots = Array.from({ length: coreCount }, (_, i) => (
    <Dot key={`c-${i + 1}`} pos={i + 1} current={current} results={results} />
  ));

  if (bonusCount <= 0) {
    return (
      <div className="flex items-center gap-1.5 justify-center" aria-hidden>
        {coreDots}
      </div>
    );
  }

  const bonusDots = Array.from({ length: bonusCount }, (_, i) => {
    const pos = coreCount + i + 1;
    return (
      <Dot
        key={`b-${pos}`}
        pos={pos}
        current={current}
        results={results}
        ariaLabel={`bonus question ${i + 1} of ${bonusCount}, from friends`}
      />
    );
  });

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center justify-center gap-1.5">
        <span className="flex items-center gap-1.5" aria-hidden>
          {coreDots}
        </span>
        <span
          aria-hidden
          className="mx-0.5 h-3 w-px shrink-0"
          style={{ background: 'color-mix(in srgb, var(--text) 22%, transparent)' }}
        />
        <span className="flex items-center gap-1.5">{bonusDots}</span>
      </div>
      <span className="type-eyebrow font-medium text-[var(--text-muted)]">
        +{bonusCount} friend bonus
      </span>
    </div>
  );
}
