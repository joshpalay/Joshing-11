import type { ReactNode } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

import { visibleFeedCategory } from './category'
import { FeedActionLink } from './FeedActionLink'
import { FeedCardShell } from './FeedCardShell'
import { FeedDismissButton } from './FeedDismissButton'
import type { FeedCardBaseItem } from './types'
import { colorForCategory, colorForUser } from './visual'

type FeedCardProps = {
  item: FeedCardBaseItem
  overflow?: ReactNode
  onAnswer?: () => void
  /** Quiet, secondary dismiss control (bottom-left, opposite Answer). View-state only. */
  onDismiss?: () => void
  /**
   * "View Answer" — a quiet secondary link sitting next to Dismiss (divided by a
   * pipe) that reveals the correct answer inline without dismissing the card.
   * The revealed answer is rendered via `revealedAnswer`. View-state only.
   */
  onViewAnswer?: () => void
  /** The revealed answer node, shown above the actions once View Answer is tapped. */
  revealedAnswer?: ReactNode
  footer?: ReactNode
  className?: string
  headerContent?: ReactNode
  /** Contextual verb shown after the name, e.g. "knows", "sent you this". */
  verb?: string
  /**
   * B-VIA-ATTRIBUTION-01: the "Via [friend]" answerer line, rendered above the
   * Answer action. Distinct from the card's own attribution (who sent/authored).
   */
  viaAttribution?: ReactNode
  /**
   * D-4 via-attribution: the "by {author}" / "via {source}" stranger-discovery
   * affordance, rendered just under the card's byline. Distinct from
   * viaAttribution (who answered) — this names who wrote it / who it came via.
   */
  discoveryAttribution?: ReactNode
  dimQuestion?: boolean
  /** Tier 1 "playable" lift on the unified home feed. Forwarded to FeedCardShell. */
  elevated?: boolean
}

// display/card/update — category line in Cormorant SemiBold (Figma 16/24/0.64px/black).
function CategoryLine({ category }: { category: string }) {
  return (
    <p className="font-serif text-base font-semibold leading-[24px] tracking-normal text-[var(--brand-ink)]">
      {category}
    </p>
  )
}

// display/card/question — the focal serif question (Figma Cormorant SemiBold 24/32/1.2px).
function QuestionText({ question, dim }: { question: string; dim?: boolean }) {
  return (
    <p
      className={cn(
        'mt-3 font-serif font-semibold leading-[32px] tracking-normal text-[var(--brand-ink)]',
        dim ? 'text-base opacity-65' : 'text-2xl',
      )}
    >
      <span aria-hidden className="opacity-60">
        &ldquo;
      </span>
      {question}
      <span aria-hidden className="opacity-60">
        &rdquo;
      </span>
    </p>
  )
}

export function FeedCard({
  item,
  overflow,
  onAnswer,
  onDismiss,
  onViewAnswer,
  revealedAnswer,
  footer,
  className,
  headerContent,
  verb,
  viaAttribution,
  discoveryAttribution,
  dimQuestion,
  elevated,
}: FeedCardProps) {
  const categoryColor = colorForCategory(item.category, item.broadCategory)
  const visibleCategory = visibleFeedCategory(item.category)
  const authorName = item.avatarName ?? 'Someone'
  // Figma colors the actor name in the user's avatar color (e.g. Allan blue,
  // Sarah slate); fall back to the link slate when no user id is present.
  const nameColor = item.avatarUserId ? colorForUser(item.avatarUserId) : 'var(--brand-link)'

  if (item.viewerIsAuthor) {
    return (
      <FeedCardShell accentColor={categoryColor} className={className}>
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {headerContent ? (
                headerContent
              ) : (
                <>
                  <p className="type-eyebrow leading-none tracking-eyebrow text-[var(--brand-ink-400)] uppercase">
                    New question
                  </p>
                  {visibleCategory ? <CategoryLine category={visibleCategory} /> : null}
                </>
              )}
            </div>
            {overflow ? <div className="shrink-0">{overflow}</div> : null}
          </div>

          <QuestionText question={item.question} />

          {item.personalMessage ? (
            <p className="mt-2 font-serif text-sm leading-snug text-[var(--brand-ink-700)] italic">
              {item.personalMessage}
            </p>
          ) : null}

          {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
      </FeedCardShell>
    )
  }

  return (
    <FeedCardShell accentColor={categoryColor} className={className} elevated={elevated}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {headerContent ? (
              headerContent
            ) : (
              <>
                <p className="type-button leading-[23px] tracking-normal text-[var(--brand-ink)]">
                  {item.authorHref ? (
                    <Link href={item.authorHref} className="font-medium" style={{ color: nameColor }}>
                      {authorName}
                    </Link>
                  ) : (
                    <span className="font-medium" style={{ color: nameColor }}>
                      {authorName}
                    </span>
                  )}
                  {verb ? ` ${verb}` : null}
                </p>
                {visibleCategory ? <CategoryLine category={visibleCategory} /> : null}
              </>
            )}
          </div>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        {discoveryAttribution ? <div className="mt-1.5">{discoveryAttribution}</div> : null}

        <QuestionText question={item.question} dim={dimQuestion} />

        {item.personalMessage ? (
          <p className="mt-2 font-serif text-sm leading-snug text-[var(--brand-ink-700)] italic">
            {item.personalMessage}
          </p>
        ) : null}

        {viaAttribution ? <div className="mt-3">{viaAttribution}</div> : null}

        {revealedAnswer ? <div className="mt-3">{revealedAnswer}</div> : null}

        {onAnswer || onDismiss || onViewAnswer ? (
          <div
            className={cn(
              'mt-3 flex items-center gap-3',
              onDismiss || onViewAnswer ? 'justify-between' : 'justify-end',
            )}
          >
            {onDismiss || onViewAnswer ? (
              <div className="flex items-center gap-2">
                {onDismiss ? <FeedDismissButton onClick={onDismiss} /> : null}
                {onDismiss && onViewAnswer ? (
                  <span aria-hidden className="text-muted-foreground/50 text-sm">
                    |
                  </span>
                ) : null}
                {onViewAnswer ? (
                  <FeedActionLink onClick={onViewAnswer} size="sm">
                    View Answer
                  </FeedActionLink>
                ) : null}
              </div>
            ) : null}
            {onAnswer ? <FeedActionLink onClick={onAnswer}>Answer →</FeedActionLink> : null}
          </div>
        ) : footer ? (
          <div className="mt-3">{footer}</div>
        ) : null}
      </div>
    </FeedCardShell>
  )
}
