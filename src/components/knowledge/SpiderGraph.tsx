import type { CSSProperties } from 'react';
import type { KnowledgeDomain } from '@/server/profile/knowledge-types';
import { KNOWLEDGE_GRAPH_DOMAIN_LIMIT } from '@/server/profile/knowledge-graph';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';
import { getAxisPosition } from '@/server/profile/knowledge-graph-axis';

type SpiderGraphProps = {
  domains: KnowledgeDomain[];
  highlightedDomainSlug?: string | null;
};

const RING_COUNT = 4;
const BAND_LABELS = ['Establishing', 'Familiar', 'Solid', 'Mastery'];

export function SpiderGraph({ domains, highlightedDomainSlug = null }: SpiderGraphProps) {
  const topDomains = domains.slice(0, KNOWLEDGE_GRAPH_DOMAIN_LIMIT);

  if (topDomains.length === 0) {
    return (
      <section style={containerStyle} aria-label="Knowledge portrait">
        <p style={emptyStyle}>Your knowledge portrait will appear here as you play.</p>
      </section>
    );
  }

  const size = 360;
  const center = size / 2;
  const outerRadius = 132;

  const polarToCartesian = (angle: number, radius: number) => {
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    return { x, y };
  };

  const axisPoints = topDomains.map((_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / topDomains.length;
    return polarToCartesian(angle, outerRadius);
  });

  const ringPolygons = Array.from({ length: RING_COUNT }, (_, ringIndex) => {
    const ratio = (ringIndex + 1) / RING_COUNT;
    const ringRadius = outerRadius * ratio;

    return topDomains
      .map((_, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / topDomains.length;
        const point = polarToCartesian(angle, ringRadius);
        return `${point.x},${point.y}`;
      })
      .join(' ');
  });

  const valuePoints = topDomains
    .map((domain, index) => {
      const normalizedRadius = getAxisPosition(domain.masteryPoints) * outerRadius;
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / topDomains.length;
      const point = polarToCartesian(angle, normalizedRadius);
      return `${point.x},${point.y}`;
    })
    .join(' ');

  return (
    <section style={containerStyle} aria-label="Knowledge portrait">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spider graph of top knowledge domains">
        {ringPolygons.map((points, index) => (
          <polygon key={`ring-${index}`} points={points} fill="none" stroke="#ddd6c7" strokeWidth="1" />
        ))}

        {axisPoints.map((point, index) => {
          const isHighlighted = highlightedDomainSlug === toCanonicalDomainSlug(topDomains[index].name);
          return (
            <line
              key={`axis-${index}`}
              x1={center}
              y1={center}
              x2={point.x}
              y2={point.y}
              stroke={isHighlighted ? '#1a1208' : '#d4cfc7'}
              strokeWidth={isHighlighted ? '2' : '1'}
              style={isHighlighted ? { animation: 'knowledge-axis-pulse 150ms ease-out 1' } : undefined}
            />
          );
        })}

        <polygon points={valuePoints} fill="rgba(43, 110, 242, 0.15)" stroke="#2b6ef2" strokeWidth="1.5" />

        {topDomains.map((domain, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / topDomains.length;
          const point = polarToCartesian(angle, getAxisPosition(domain.masteryPoints) * outerRadius);
          const isHighlighted = highlightedDomainSlug === toCanonicalDomainSlug(domain.name);
          return (
            <circle
              key={`dot-${domain.name}`}
              cx={point.x}
              cy={point.y}
              r={isHighlighted ? 5.5 : 4}
              fill="#2b6ef2"
              style={isHighlighted ? { animation: 'knowledge-dot-pulse 300ms ease-in-out 1', filter: 'drop-shadow(0 0 8px #f0c060)' } : undefined}
            />
          );
        })}

        {BAND_LABELS.map((label, index) => (
          <text
            key={label}
            x={center - 8}
            y={center - outerRadius * ((index + 1) / 4) - 2}
            textAnchor="end"
            dominantBaseline="central"
            fontSize="9"
            fill="#8a8070"
          >
            {label}
          </text>
        ))}

        {axisPoints.map((_, index) => {
          const labelRadius = outerRadius + 30;
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / topDomains.length;
          const labelPoint = polarToCartesian(angle, labelRadius);
          const domain = topDomains[index];
          const isHighlighted = highlightedDomainSlug === toCanonicalDomainSlug(domain.name);
          const label = domain.name.length > 18 ? `${domain.name.slice(0, 17)}…` : domain.name;
          return (
            <text key={`label-${domain.name}`} x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" fontSize="14" fill={isHighlighted ? '#1a1208' : '#1f1c17'}>
              {label}
            </text>
          );
        })}
      </svg>
      <style>{`
        @keyframes knowledge-axis-pulse {
          0% { stroke: #d4cfc7; }
          100% { stroke: #1a1208; }
        }
        @keyframes knowledge-dot-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }
      `}</style>
    </section>
  );
}

const containerStyle = {
  width: '100%',
  maxWidth: 520,
  margin: '0 auto 0.35rem',
  padding: '1rem 0.5rem 0.35rem',
} satisfies CSSProperties;

const emptyStyle = {
  margin: 0,
  textAlign: 'center',
  fontSize: '0.95rem',
  color: '#6f6759',
} satisfies CSSProperties;
