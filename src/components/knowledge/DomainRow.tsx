import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { DomainProgressBar } from '@/components/knowledge/DomainProgressBar';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';
import type { MasteryTier } from '@/types/db';

type DomainRowProps = {
  domain: string;
  masteryPoints: number;
  yourQuestionsCount: number;
  href?: string;
  highlighted?: boolean;
  elementId?: string;
  tierOverride?: MasteryTier;
  progressOverride?: number;
  /** Optional control rendered on the right side of the row. When provided, the chevron is hidden. */
  trailingControl?: ReactNode;
};

const CONTRIBUTION_DOT_COUNT = 5;

export function DomainRow({
  domain,
  masteryPoints,
  yourQuestionsCount,
  href,
  highlighted = false,
  elementId,
  tierOverride,
  progressOverride,
  trailingControl,
}: DomainRowProps) {
  const display = getMasteryTierDisplay(masteryPoints);
  const tier = tierOverride ?? display.tier;
  const progressWithinTier = progressOverride ?? display.progressWithinTier;
  const tierLabel = masteryPoints === 0 ? 'New territory' : KNOWLEDGE_TIER_LABEL[tier];
  const contributionDots = getContributionDotsFilled(yourQuestionsCount);
  const showMasteryNudge = yourQuestionsCount === 0 && (tier === 'solid' || tier === 'mastery');
  const content = (
    <div id={elementId} style={{ ...rowStyle, ...(highlighted ? highlightStyle : null) }}>
      <div style={contentStyle}>
        <p style={titleStyle}>{domain}</p>
        <p style={statusStyle}>{tierLabel}</p>
        <DomainProgressBar tier={tier} progressWithinTier={progressWithinTier} />
        <div style={metaRowStyle}>
          {showMasteryNudge ? (
            <span style={metaLabelStyle}>Add questions here to reach mastery.</span>
          ) : (
            <>
              <span style={metaLabelStyle}>Your q’s</span>
              <div style={dotsWrapStyle} aria-hidden>
                {Array.from({ length: CONTRIBUTION_DOT_COUNT }).map((_, index) => (
                  <span
                    key={`${domain}-dot-${index}`}
                    style={{
                      ...dotStyle,
                      background: index < contributionDots ? '#111111' : '#ddd6c7',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {trailingControl ?? (
        <span style={chevronStyle} aria-hidden>
          ›
        </span>
      )}
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} style={linkStyle} aria-label={`${domain}. ${tierLabel}.`}>
      {content}
    </Link>
  );
}

function getContributionDotsFilled(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  if (count <= 10) return 4;
  return 5;
}

const linkStyle: CSSProperties = {
  textDecoration: 'none',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.95rem 0.2rem',
  border: '1px solid #e8e2d6',
  borderRadius: '8px',
  transition: 'background-color 300ms ease, border-color 300ms ease',
};

const highlightStyle: CSSProperties = {
  backgroundColor: 'rgba(43, 110, 242, 0.08)',
  borderColor: '#1a1208',
};

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  color: 'var(--text)',
};

const statusStyle: CSSProperties = {
  margin: '0.15rem 0 0',
  color: '#696257',
  fontSize: '0.88rem',
};

const metaRowStyle: CSSProperties = {
  marginTop: '0.45rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

const metaLabelStyle: CSSProperties = {
  fontSize: '0.76rem',
  color: '#696257',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const dotsWrapStyle: CSSProperties = {
  display: 'inline-flex',
  gap: '0.24rem',
  alignItems: 'center',
};

const dotStyle: CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '999px',
};

const chevronStyle: CSSProperties = {
  fontSize: '1rem',
  color: '#7d7568',
};

