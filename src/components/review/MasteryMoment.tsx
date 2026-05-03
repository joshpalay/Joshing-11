'use client';

import { useEffect, useState } from 'react';

import type { MasteryTier } from '@/types/db';

type Props = {
  subcategory: string;
  newTier: MasteryTier;
  onDismiss?: () => void;
  durationMs?: number;
};

function copyForTier(tier: MasteryTier, subcategory: string): string {
  if (tier === 'familiar') return `${subcategory}. You're finding your ground.`;
  if (tier === 'solid') return `${subcategory}. You move through this naturally now.`;
  if (tier === 'mastery') return `${subcategory}. This one's yours.`;
  return `${subcategory}.`;
}

function formatTierLabel(tier: MasteryTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function MasteryMoment({
  subcategory,
  newTier,
  onDismiss,
  durationMs = 2600,
}: Props) {
  const [visible, setVisible] = useState(true);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const enterTimer = window.setTimeout(() => setEntered(true), 30);
    const dismissTimer = window.setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, durationMs);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [durationMs, onDismiss]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setVisible(false);
        onDismiss?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        border: 'none',
        padding: '24px',
        cursor: 'pointer',
        background: '#f5f0e8',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 420ms ease, transform 420ms ease',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontSize: 'clamp(1.2rem, 4vw, 1.6rem)',
            color: 'rgba(26,18,8,0.72)',
            marginBottom: '12px',
          }}
        >
          {subcategory}
        </p>
        <p
          style={{
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontSize: 'clamp(2rem, 7vw, 3rem)',
            fontWeight: 700,
            color: 'rgba(26,18,8,0.9)',
            marginBottom: '16px',
          }}
        >
          {formatTierLabel(newTier)}
        </p>
        <p style={{ fontSize: '0.95rem', color: 'rgba(26,18,8,0.48)', maxWidth: '22rem', lineHeight: 1.45 }}>
          {copyForTier(newTier, subcategory)}
        </p>
      </div>
    </button>
  );
}
