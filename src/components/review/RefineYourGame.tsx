'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { RefineSectionView } from '@/server/refine/types';
import { RefineItemCard } from './RefineItemCard';

// Matches the other daily-summary section headers (titleStyle in page.tsx) so
// this reads as a calm peer section, not a headline.
const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

export function RefineYourGame({ refine }: { refine: RefineSectionView }) {
  const { items, queueId } = refine;
  const isEmpty = items.length === 0;

  return (
    <section className="card mt-5 px-5 py-4">
      <h2 style={titleStyle}>Refine Your Game</h2>

      {isEmpty ? (
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          You&apos;re looking good. If you want to make changes or add a territory, you can do that
          here.
        </p>
      ) : (
        <div className="mt-1">
          {items.map((item, index) => (
            <div key={item.id} className={index > 0 ? 'border-border border-t' : ''}>
              <RefineItemCard item={item} queueId={queueId ?? ''} />
            </div>
          ))}
        </div>
      )}

      <Link
        href="/daily/setup"
        className="text-muted-foreground mt-4 inline-block text-sm underline-offset-4 hover:underline"
      >
        Manage your territories in Settings →
      </Link>
    </section>
  );
}
