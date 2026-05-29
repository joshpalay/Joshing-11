import type { ReactNode } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

import { visibleFeedCategory } from './category'
import type { FeedCardBaseItem } from './types'
import { colorForCategory, colorForUser } from './visual'

type FeedCardProps = {
  item: FeedCardBaseItem
  overflow?: ReactNode
  onAnswer?: () => void
  footer?: ReactNode
  className?: string
  headerContent?: ReactNode
  /** Contextual verb shown after the name, e.g. "knows", "sent you this". */
  verb?: string
  dimQuestion?: boolean
}

// Shared card chrome from the Figma feed cards: near-white surface, hairline
// border/rule, 4px radius (space/1), soft shadow. The category/domain accent is
// a 2px bar across the top (Figma renders it via an inset top shadow).
const CARD_CLASS =
  'relative overflow-hidden rounded-md border border-[var(--brand-rule)] bg-[var(--brand-card)] shadow-[0_4px_12px_rgba(40,32,30,0.04)]'

// display/card/update — category line in Cormorant serif.
function CategoryLine({ category }: { category: string }) {
  return (
    <p className="font-serif text-[16px] leading-[24px] tracking-[0.03em] text-[var(--brand-ink)]">
      {category}
    </p>
  )
}

// display/card/question — the focal serif question.
function QuestionText({ question, dim }: { question: string; dim?: boolean }) {
  return (
    <p
      className={cn(
        'mt-3 font-serif leading-[32px] tracking-[0.04em] text-[var(--brand-ink)]',
        dim ? 'text-[16px] opacity-65' : 'text-[24px]',
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
  footer,
  className,
  headerContent,
  verb,
  dimQuestion,
}: FeedCardProps) {
  const categoryColor = colorForCategory(item.category)
  const visibleCategory = visibleFeedCategory(item.category)
  const authorName = item.avatarName ?? 'Someone'
  // Figma colors the actor name in the user's avatar color (e.g. Allan blue,
  // Sarah slate); fall back to the link slate when no user id is present.
  const nameColor = item.avatarUserId ? colorForUser(item.avatarUserId) : 'var(--brand-link)'

  const topBar = (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-[2px]"
      style={{ backgroundColor: categoryColor }}
    />
  )

  if (item.viewerIsAuthor) {
    return (
      <article className={cn(CARD_CLASS, className)}>
        {topBar}
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
            <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--brand-ink-700)] italic">
              {item.personalMessage}
            </p>
          ) : null}

          {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
      </article>
    )
  }

  return (
    <article className={cn(CARD_CLASS, className)}>
      {topBar}
      <div className="p-[14px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {headerContent ? (
              headerContent
            ) : (
              <>
                <p className="text-[15px] leading-[23px] tracking-[0.02em] text-[var(--brand-ink)]">
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
          <p className="mt-2 font-serif text-[14px] leading-snug text-[var(--brand-ink-700)] italic">
            {item.personalMessage}
          </p>
        ) : null}

        {onAnswer ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onAnswer}
              className="font-serif text-[18px] font-semibold tracking-wide text-[var(--brand-link)] underline underline-offset-4 transition hover:opacity-70"
            >
              Answer →
            </button>
          </div>
        ) : footer ? (
          <div className="mt-3">{footer}</div>
        ) : null}
      </div>
    </article>
  )
}
