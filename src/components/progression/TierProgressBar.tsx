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
  const fillRatio = tier === 'mastery' ? 1 : Math.max(0.08, clamped);
  const tierLabel = getKnowledgeTierProgressionLabel(tier);
  const nextTier = getNextTier(tier);

  return (
    <div style={wrapStyle} aria-label={`${ariaLabelPrefix}: current level ${tierLabel}${nextTier ? `, next level ${getKnowledgeTierProgressionLabel(nextTier)}` : ''}`}>
      <div style={trackStyle} aria-hidden>
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
  background: '#f3f1eb',
  overflow: 'hidden',
  border: '1px solid var(--border-warm)',
};

const fillStyle: CSSProperties = {
  height: '100%',
  borderRadius: 'inherit',
  background: '#2b6ef2',
};
