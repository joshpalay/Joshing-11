'use client';

import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
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

// Mirrors the Customize pill on the home page's Daily Five box
// (CUSTOMIZE_DAILY_LINK_CLASS in TodaysFiveCard.tsx) so the two surfaces share
// one customize affordance and route to the same /daily/setup screen.
const CUSTOMIZE_DAILY_LINK_CLASS = [
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full',
  'border border-[color-mix(in_srgb,var(--brand-border)_60%,transparent)] bg-[var(--brand-cream-page)] px-3 py-2',
  'text-[12px] font-bold tracking-[0.01em] whitespace-nowrap text-[var(--brand-ink)]',
  'transition-[background-color,border-color,transform]',
  'hover:border-[color-mix(in_srgb,var(--brand-ink)_24%,var(--brand-border))] hover:bg-[var(--brand-card)]',
  'focus-visible:ring-2 focus-visible:ring-[var(--brand-ink)] focus-visible:ring-offset-2 focus-visible:outline-none',
  'active:translate-y-px sm:px-3.5 sm:text-[13px]',
].join(' ');

export function RefineYourGame({ refine }: { refine: RefineSectionView }) {
  const { items, queueId } = refine;
  const isEmpty = items.length === 0;

  return (
    <section className="card mt-5 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 style={titleStyle}>Refine Your Game</h2>
        <Link
          href="/daily/setup"
          className={CUSTOMIZE_DAILY_LINK_CLASS}
          aria-label="Customize your Daily Five"
        >
          <SlidersHorizontal className="size-4 sm:size-[18px]" strokeWidth={2.4} aria-hidden="true" />
          <span>Customize</span>
        </Link>
      </div>

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
    </section>
  );
}
