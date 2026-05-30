import type { CSSProperties } from 'react';
import type { MasteryTier } from '@/types/db';
import { getKnowledgeTierProgressionLabel } from '@/server/profile/knowledge-tier-copy';

type TierProgressBarProps = {
  tier: MasteryTier;
  progressWithinTier: number;
  ariaLabelPrefix?: string;
};

export function TierProgressBar({ tier, progressWithinTier, ariaLabelPrefix = 'Domain progression' }: TierProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progressWithinTier));
  const fillRatio = tier === 'mastery' ? 1 : clamped;
  const tierLabel = getKnowledgeTierProgressionLabel(tier);
  const nextTier = getNextTier(tier);

  return (
    <div
      style={wrapStyle}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fillRatio * 100)}
      aria-label={`${ariaLabelPrefix}: current level ${tierLabel}${nextTier ? `, next level ${getKnowledgeTierProgressionLabel(nextTier)}` : ''}`}
    >
      <div style={trackStyle}>
        <div style={{ ...fillStyle, width: `${fillRatio * 100}%` }} />
      </div>
    </div>
  );
}

function getNextTier(tier: MasteryTier): MasteryTier | null {
  if (tier === 'establishing') return 'familiar';
  if (tier === 'familiar') return 'solid';
  if (tier === 'solid') return 'mastery';
  return null;
}

const wrapStyle: CSSProperties = {
  marginTop: '0.45rem',
};

const trackStyle: CSSProperties = {
  height: '10px',
  borderRadius: '999px',
  background: 'var(--muted)',
  overflow: 'hidden',
  border: '1px solid var(--border-warm)',
};

const fillStyle: CSSProperties = {
  height: '100%',
  borderRadius: 'inherit',
  background: 'var(--brand-navy)',
};
