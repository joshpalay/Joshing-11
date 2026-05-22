import type { ReactNode } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

import { visibleFeedCategory } from './category'
import type { FeedCardBaseItem } from './types'
import { colorForCategory, initialsFor, isDarkColor } from './visual'

type FeedCardProps = {
  item: FeedCardBaseItem
  overflow?: ReactNode
  onAnswer?: () => void
  footer?: ReactNode
  className?: string
  headerContent?: ReactNode
  dimQuestion?: boolean
}

export function FeedCard({
  item,
  overflow,
  onAnswer,
  footer,
  className,
  headerContent,
  dimQuestion,
}: FeedCardProps) {
  const categoryColor = colorForCategory(item.category)
  const visibleCategory = visibleFeedCategory(item.category)
  const onDark = isDarkColor(categoryColor)
  const fgOnCategory = onDark ? 'var(--cream)' : 'var(--ink)'
  const authorName = item.avatarName ?? 'Someone'

  if (item.viewerIsAuthor) {
    return (
      <article
        className={cn(
          'relative overflow-hidden rounded-2xl border border-[var(--border-warm)] bg-[var(--cream)]',
          className,
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px]"
          style={{ backgroundColor: categoryColor }}
        />

        <div className="p-[14px]">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: categoryColor, color: fgOnCategory }}
            >
              You
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="text-[11px] uppercase leading-none tracking-[0.08em]"
                style={{ color: 'var(--ink)', opacity: 0.7 }}
              >
                New question
              </p>
              {visibleCategory ? (
                <p
                  className="mt-1 truncate text-[12px] italic leading-tight"
                  style={{
                    fontFamily: 'var(--font-literata)',
                    color: 'var(--ink)',
                    opacity: 0.7,
                  }}
                >
                  {visibleCategory}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {item.timestamp ? (
                <span
                  className="text-[11px] leading-none"
                  style={{ color: 'var(--ink)', opacity: 0.6 }}
                >
                  {item.timestamp}
                </span>
              ) : null}
              {overflow ? overflow : null}
            </div>
          </div>

          <p
            className="mt-3 line-clamp-4 text-[17px] leading-snug text-[var(--ink)]"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            &ldquo;{item.question}&rdquo;
          </p>

          {item.personalMessage ? (
            <p
              className="mt-2 text-[13px] italic leading-snug"
              style={{
                fontFamily: 'var(--font-literata)',
                color: 'var(--ink)',
                opacity: 0.65,
              }}
            >
              {item.personalMessage}
            </p>
          ) : null}
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[var(--border-warm)] bg-[var(--cream)]',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ backgroundColor: categoryColor }}
      />

      <div className="p-[14px]">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold tracking-wide"
            style={{ backgroundColor: categoryColor, color: fgOnCategory }}
          >
            {initialsFor(authorName)}
          </div>

          <div className="min-w-0 flex-1">
            {headerContent ? (
              headerContent
            ) : (
              <>
                {item.authorHref ? (
                  <Link
                    href={item.authorHref}
                    className="block truncate text-[16px] leading-tight text-[var(--ink)] underline underline-offset-2"
                    style={{ textDecorationColor: 'rgb(0 0 0 / 0.35)' }}
                  >
                    {authorName}
                  </Link>
                ) : (
                  <span className="block truncate text-[16px] leading-tight text-[var(--ink)]">
                    {authorName}
                  </span>
                )}
                {visibleCategory ? (
                  <p
                    className="mt-0.5 truncate text-[12px] italic leading-tight"
                    style={{
                      fontFamily: 'var(--font-literata)',
                      color: 'var(--ink)',
                      opacity: 0.7,
                    }}
                  >
                    {visibleCategory}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {item.timestamp ? (
              <span
                className="text-[11px] leading-none"
                style={{ color: 'var(--ink)', opacity: 0.6 }}
              >
                {item.timestamp}
              </span>
            ) : null}
            {overflow ? overflow : null}
          </div>
        </div>

        <p
          className={cn(
            'mt-3 line-clamp-4 leading-snug text-[var(--ink)]',
            dimQuestion ? 'text-[14px]' : 'text-[17px]',
          )}
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            ...(dimQuestion ? { opacity: 0.65 } : null),
          }}
        >
          {item.question}
        </p>

        {item.personalMessage ? (
          <p
            className="mt-2 text-[13px] italic leading-snug"
            style={{
              fontFamily: 'var(--font-literata)',
              color: 'var(--ink)',
              opacity: 0.65,
            }}
          >
            {item.personalMessage}
          </p>
        ) : null}

        {onAnswer ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onAnswer}
              className="inline-flex items-center border-[1.5px] border-[var(--ink)] bg-[var(--cream)] px-[10px] py-[6px] text-[14px] text-[var(--ink)] transition-transform hover:translate-x-[1px] hover:translate-y-[1px] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
              style={{ boxShadow: '4px 4px 0 var(--ink)' }}
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
