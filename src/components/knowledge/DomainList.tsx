import type { CSSProperties } from 'react';
import type { KnowledgeDomain } from '@/server/profile/knowledge-types';
import { KNOWLEDGE_GRAPH_DOMAIN_LIMIT } from '@/server/profile/knowledge-graph';
import { getKnowledgeTierInterpretation } from '@/server/profile/knowledge-tier-copy';
import { DomainProgressBar } from '@/components/knowledge/DomainProgressBar';

type DomainListProps = {
  domains: KnowledgeDomain[];
};

export function DomainList({ domains }: DomainListProps) {
  const overflowDomains = domains.slice(KNOWLEDGE_GRAPH_DOMAIN_LIMIT);

  if (overflowDomains.length === 0) {
    return null;
  }

  return (
    <section aria-label="More domains" style={sectionStyle}>
      <ul style={listStyle}>
        {overflowDomains.map((domain) => (
          <li key={domain.name} style={listItemStyle}>
            <p style={domainNameStyle}>{domain.name}</p>
            <p style={tierStyle}>{getKnowledgeTierInterpretation(domain.tier)}</p>
            <DomainProgressBar tier={domain.tier} progressWithinTier={domain.progressWithinTier} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const sectionStyle: CSSProperties = {
  marginTop: '0.75rem',
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gap: '0.5rem',
};

const listItemStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
  paddingBottom: '0.4rem',
  borderBottom: '1px solid rgba(123, 97, 255, 0.18)',
};

const domainNameStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(26, 19, 51, 0.9)',
};

const tierStyle: CSSProperties = {
  margin: 0,
  color: 'rgba(73, 63, 105, 0.82)',
  fontSize: '0.92rem',
};
