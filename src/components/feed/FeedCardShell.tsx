import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// One shell for the whole feed surface. Before this, the feed carried three
// diverging card chromes (the 2026-05-30 design audit, C7):
//   • FeedCard — hairline --brand-rule border, near-white --brand-card surface,
//     4px radius (Figma space/1), soft shadow, a 2px category bar across the top;
//   • SparkleEnvelope — the app triangle-pattern mat (Variant4.png) over a
//     --brand-card panel, for "shared with you" cards;
//   • AnsweredByYouCard — a left-bar card on rounded-2xl + --border-warm, no shadow.
// They now share this primitive: a single radius, surface, border, and shadow,
// with the accent bar configurable to the top (default) or left edge, and a
// 'triangle' variant for the envelope motif.

const FEED_CARD_RADIUS = 'rounded-[4px]'
const FEED_CARD_SHADOW = 'shadow-[0_4px_12px_rgba(40,32,30,0.04)]'

export type FeedCardShellProps = {
  children: ReactNode
  className?: string
  /** Category/domain accent color for the edge bar. Omit for no bar. */
  accentColor?: string
  /** Which edge the accent bar sits on. Defaults to the top. */
  accentPlacement?: 'top' | 'left'
  /**
   * 'bordered' (default) — hairline border + soft shadow over --brand-card.
   * 'triangle' — the Variant4.png triangle mat with an inset --brand-card panel
   * (the "shared with you" envelope motif).
   */
  variant?: 'bordered' | 'triangle'
}

export function FeedCardShell({
  children,
  className,
  accentColor,
  accentPlacement = 'top',
  variant = 'bordered',
}: FeedCardShellProps) {
  const accentBar = accentColor ? (
    <span
      aria-hidden
      className={cn(
        'absolute',
        accentPlacement === 'left' ? 'inset-y-0 left-0 w-[2px]' : 'inset-x-0 top-0 h-[2px]',
      )}
      style={{ backgroundColor: accentColor }}
    />
  ) : null

  if (variant === 'triangle') {
    return (
      <article
        className={cn(
          "overflow-hidden bg-[url('/images/Variant4.png')] bg-[length:300px_auto] bg-center p-3",
          FEED_CARD_RADIUS,
          FEED_CARD_SHADOW,
          className,
        )}
      >
        <div className={cn('relative overflow-hidden bg-[var(--brand-card)]', FEED_CARD_RADIUS)}>
          {accentBar}
          {children}
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'relative overflow-hidden border border-[var(--brand-rule)] bg-[var(--brand-card)]',
        FEED_CARD_RADIUS,
        FEED_CARD_SHADOW,
        className,
      )}
    >
      {accentBar}
      {children}
    </article>
  )
}
