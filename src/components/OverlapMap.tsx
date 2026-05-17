import type { CSSProperties, ReactElement } from 'react';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';

export type OverlapMapPlayer = { id: string; name: string; color: string };

export type OverlapMapCell = {
  broadCategory: string;
  canonicalSubcategory: string;
  aScore: number;
  bScore: number;
  aCorrect: number;
  bCorrect: number;
  sharedCorrect: number;
};

export type OverlapMapProps = {
  players: [OverlapMapPlayer, OverlapMapPlayer];
  cells: OverlapMapCell[];
};

const MIN_DIAMETER = 22;
const MAX_DIAMETER = 56;
const CIRCLE_OPACITY = 0.72;

const INK = '#1a1a1a';
const CREAM = '#faf8f2';
const MUTED_INK = '#5a5448';

const cardStyle: CSSProperties = {
  background: CREAM,
  border: `2px solid ${INK}`,
  boxShadow: `6px 6px 0 ${INK}`,
  borderRadius: 0,
  padding: '24px 22px 22px',
  color: INK,
};

const monoLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: INK,
};

const monoMuted: CSSProperties = {
  ...monoLabel,
  color: MUTED_INK,
};

const courierHeader: CSSProperties = {
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.22em',
  color: INK,
};

const italicSerif: CSSProperties = {
  fontFamily: 'var(--font-display, "Playfair Display"), Georgia, serif',
  fontStyle: 'italic',
};

function overlapRatioOf(cell: OverlapMapCell): number {
  const denom = Math.max(cell.aCorrect, cell.bCorrect);
  if (denom <= 0) return 0;
  return cell.sharedCorrect / denom;
}

function CategoryItem({
  cell,
  players,
  maxScore,
}: {
  cell: OverlapMapCell;
  players: [OverlapMapPlayer, OverlapMapPlayer];
  maxScore: number;
}): ReactElement {
  const dA = MIN_DIAMETER + (cell.aScore / maxScore) * (MAX_DIAMETER - MIN_DIAMETER);
  const dB = MIN_DIAMETER + (cell.bScore / maxScore) * (MAX_DIAMETER - MIN_DIAMETER);
  const rA = dA / 2;
  const rB = dB / 2;
  const overlapRatio = overlapRatioOf(cell);
  const centerGap = (rA + rB) * (1 - overlapRatio * 0.85);
  const svgWidth = rA + centerGap + rB;
  const svgHeight = Math.max(dA, dB);
  const cxA = rA;
  const cxB = rA + centerGap;
  const cy = svgHeight / 2;
  const sharedPct = Math.round(overlapRatio * 100);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        minWidth: '120px',
        maxWidth: '160px',
        padding: '4px 6px',
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label={`${players[0].name} and ${players[1].name} share ${sharedPct} percent of ${cell.canonicalSubcategory}`}
      >
        <circle cx={cxA} cy={cy} r={rA} fill={players[0].color} opacity={CIRCLE_OPACITY} />
        <circle cx={cxB} cy={cy} r={rB} fill={players[1].color} opacity={CIRCLE_OPACITY} />
      </svg>
      <p
        style={{
          ...italicSerif,
          fontSize: '0.95rem',
          textAlign: 'center',
          lineHeight: 1.15,
          color: INK,
          margin: 0,
        }}
      >
        {cell.canonicalSubcategory}
      </p>
      <p style={{ ...monoMuted, margin: 0 }}>{sharedPct}% shared</p>
    </div>
  );
}

export function OverlapMap({ players, cells }: OverlapMapProps): ReactElement | null {
  const totalA = cells.reduce((sum, cell) => sum + cell.aScore, 0);
  const totalB = cells.reduce((sum, cell) => sum + cell.bScore, 0);
  if (cells.length === 0 || totalA === 0 || totalB === 0) return null;

  const visible = cells.filter((cell) => cell.sharedCorrect > 0 && overlapRatioOf(cell) > 0);

  const grouped = new Map<string, OverlapMapCell[]>();
  for (const cell of visible) {
    const list = grouped.get(cell.broadCategory) ?? [];
    list.push(cell);
    grouped.set(cell.broadCategory, list);
  }

  const maxScore = visible.length === 0
    ? 1
    : Math.max(1, ...visible.flatMap((cell) => [cell.aScore, cell.bScore]));

  const strongest = visible.reduce<OverlapMapCell | null>((best, cell) => {
    const ratio = overlapRatioOf(cell);
    const score = ratio * (cell.aScore + cell.bScore);
    if (!best) return cell;
    const bestRatio = overlapRatioOf(best);
    const bestScore = bestRatio * (best.aScore + best.bScore);
    return score > bestScore ? cell : best;
  }, null);

  const headline = (
    <h2
      style={{
        ...italicSerif,
        fontSize: '1.65rem',
        lineHeight: 1.1,
        margin: 0,
        color: INK,
      }}
    >
      <span style={{ fontStyle: 'normal', fontFamily: 'var(--font-neutral), system-ui, sans-serif' }}>
        Where you&apos;ve met
      </span>
      <br />
      <span>so far.</span>
    </h2>
  );

  const legend = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '14px',
        marginTop: '14px',
        paddingTop: '12px',
        borderTop: `1px solid ${INK}`,
      }}
    >
      {players.map((player) => (
        <span
          key={player.id}
          style={{
            ...monoLabel,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: player.color,
              border: `1.5px solid ${INK}`,
            }}
          />
          {player.name}
        </span>
      ))}
    </div>
  );

  if (visible.length === 0) {
    return (
      <section style={cardStyle}>
        {headline}
        {legend}
        <p
          style={{
            ...italicSerif,
            fontSize: '0.95rem',
            color: MUTED_INK,
            marginTop: '20px',
            marginBottom: 0,
          }}
        >
          You haven&apos;t answered the same question correctly yet. Keep playing.
        </p>
      </section>
    );
  }

  const groupEntries = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <section style={cardStyle}>
      {headline}
      {legend}

      <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {groupEntries.map(([broad, items]) => {
          const domainColor = getPortraitDomainColor(broad).primary;
          return (
            <div key={broad}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: '10px',
                    height: '10px',
                    background: domainColor,
                    border: `1.5px solid ${INK}`,
                  }}
                />
                <span style={courierHeader}>{broad}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '14px',
                  rowGap: '18px',
                }}
              >
                {items
                  .slice()
                  .sort((a, b) => b.sharedCorrect - a.sharedCorrect || a.canonicalSubcategory.localeCompare(b.canonicalSubcategory))
                  .map((cell) => (
                    <CategoryItem
                      key={cell.canonicalSubcategory}
                      cell={cell}
                      players={players}
                      maxScore={maxScore}
                    />
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {strongest ? (
        <div
          style={{
            marginTop: '24px',
            padding: '16px 18px',
            background: CREAM,
            border: `2px solid ${INK}`,
            boxShadow: `4px 4px 0 ${INK}`,
          }}
        >
          <p style={{ ...monoLabel, margin: 0 }}>Your strongest overlap</p>
          <p
            style={{
              ...italicSerif,
              fontSize: '1.35rem',
              margin: '6px 0 0',
              color: INK,
            }}
          >
            {strongest.canonicalSubcategory}
          </p>
        </div>
      ) : null}

      <p
        style={{
          ...italicSerif,
          fontSize: '0.78rem',
          color: MUTED_INK,
          marginTop: '14px',
          marginBottom: 0,
          lineHeight: 1.4,
        }}
      >
        Categories where neither of you has answered correctly together are hidden. They&apos;ll appear when you do.
      </p>
    </section>
  );
}
