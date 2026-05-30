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
  pointsLabel?: string;
  declared?: boolean;
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
  pointsLabel,
  declared = false,
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
              <span style={metaLabelStyle}>Your q's</span>
              <div style={dotsWrapStyle} aria-hidden>
                {Array.from({ length: CONTRIBUTION_DOT_COUNT }).map((_, index) => (
                  <span
                    key={`${domain}-dot-${index}`}
                    style={{
                      ...dotStyle,
                      background: index < contributionDots ? 'var(--warm-ink)' : 'var(--warm-border-soft)',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {trailingControl ?? (
        <div style={trailingStyle}>
          {declared ? <span style={declaredBadgeStyle}>Declared</span> : null}
          {pointsLabel ? <span style={pointsStyle}>{pointsLabel}</span> : null}
          <span style={chevronStyle} aria-hidden>
            &rsaquo;
          </span>
        </div>
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
  border: '1px solid var(--warm-border)',
  borderRadius: '8px',
  transition: 'background-color 300ms ease, border-color 300ms ease',
};

const highlightStyle: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--brand-navy) 8%, transparent)',
  borderColor: 'var(--brand-ink)',
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
  color: 'var(--warm-ink-700)',
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
  color: 'var(--warm-ink-700)',
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

const trailingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexShrink: 0,
};

const declaredBadgeStyle: CSSProperties = {
  border: '1px solid var(--warm-ink)',
  borderRadius: '999px',
  padding: '0.16rem 0.42rem',
  color: 'var(--warm-ink)',
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const pointsStyle: CSSProperties = {
  minWidth: '4.2rem',
  textAlign: 'right',
  color: 'var(--warm-ink)',
  fontSize: '0.88rem',
  fontWeight: 600,
};

const chevronStyle: CSSProperties = {
  fontSize: '1rem',
  color: 'var(--warm-ink-500)',
};
