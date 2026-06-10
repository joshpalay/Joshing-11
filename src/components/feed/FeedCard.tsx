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
  footer?: ReactNode
  className?: string
  headerContent?: ReactNode
  /** Contextual verb shown after the name, e.g. "knows", "sent you this". */
  verb?: string
  dimQuestion?: boolean
  /** Tier 1 "playable" lift on the unified home feed. Forwarded to FeedCardShell. */
  elevated?: boolean
}

// display/card/update — category line in Cormorant SemiBold (Figma 16/24/0.64px/black).
function CategoryLine({ category }: { category: string }) {
  return (
    <p className="font-serif text-base font-semibold leading-[24px] tracking-[0.04em] text-[var(--brand-ink)]">
      {category}
    </p>
  )
}

// display/card/question — the focal serif question (Figma Cormorant SemiBold 24/32/1.2px).
function QuestionText({ question, dim }: { question: string; dim?: boolean }) {
  return (
    <p
      className={cn(
        'mt-3 font-serif font-semibold leading-[32px] tracking-[0.05em] text-[var(--brand-ink)]',
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
  footer,
  className,
  headerContent,
  verb,
  dimQuestion,
  elevated,
}: FeedCardProps) {
  const categoryColor = colorForCategory(item.category)
  const visibleCategory = visibleFeedCategory(item.category)
  const authorName = item.avatarName ?? 'Someone'
  // Figma colors the actor name in the user's avatar color (e.g. Allan blue,
  // Sarah slate); fall back to the link slate when no user id is present.
  const nameColor = item.avatarUserId ? colorForUser(item.avatarUserId) : 'var(--brand-link)'

  if (item.viewerIsAuthor) {
    return (
      <FeedCardShell accentColor={categoryColor} className={className}>
        <div className="p-[14px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {headerContent ? (
                headerContent
              ) : (
                <>
                  <p className="text-[11px] leading-none tracking-[0.08em] text-[var(--brand-ink-400)] uppercase">
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
      <div className="p-[14px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {headerContent ? (
              headerContent
            ) : (
              <>
                <p className="text-[15px] leading-[23px] tracking-[0.05em] text-[var(--brand-ink)]">
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

        <QuestionText question={item.question} dim={dimQuestion} />

        {item.personalMessage ? (
          <p className="mt-2 font-serif text-sm leading-snug text-[var(--brand-ink-700)] italic">
            {item.personalMessage}
          </p>
        ) : null}

        {onAnswer ? (
          <div
            className={cn(
              'mt-3 flex items-center gap-3',
              onDismiss ? 'justify-between' : 'justify-end',
            )}
          >
            {onDismiss ? <FeedDismissButton onClick={onDismiss} /> : null}
            <FeedActionLink onClick={onAnswer}>Answer →</FeedActionLink>
          </div>
        ) : footer ? (
          <div className="mt-3">{footer}</div>
        ) : null}
      </div>
    </FeedCardShell>
  )
}
