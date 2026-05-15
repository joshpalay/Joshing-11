import { cn } from '@/lib/utils'

import { visibleFeedCategory } from './category'
import type { FeedCardShellProps, FeedCardTone } from './types'

const toneClasses: Record<FeedCardTone, string> = {
  cream:
    'border-amber-200/80 bg-[#fff7df] shadow-[0_1px_0_rgba(120,83,25,0.08)]',
  white: 'border-stone-200 bg-white shadow-sm',
  green:
    'border-emerald-200 bg-emerald-50/80 shadow-[0_1px_0_rgba(22,101,52,0.08)]',
  amber:
    'border-orange-200 bg-orange-50/80 shadow-[0_1px_0_rgba(154,52,18,0.08)]',
  gray: 'border-stone-200 bg-stone-100/80 text-stone-800 shadow-none',
}

const categoryToneClasses: Record<FeedCardTone, string> = {
  cream: 'text-amber-700',
  white: 'text-stone-500',
  green: 'text-emerald-700',
  amber: 'text-orange-700',
  gray: 'text-stone-500',
}

const dividerToneClasses: Record<FeedCardTone, string> = {
  cream: 'border-amber-200/60',
  white: 'border-stone-200',
  green: 'border-emerald-200/60',
  amber: 'border-orange-200/60',
  gray: 'border-stone-200',
}

export function FeedCard({
  item,
  tone,
  socialSignal,
  overflow,
  onAnswer,
  resultContent,
  className,
}: FeedCardShellProps) {
  const category = visibleFeedCategory(item.category)
  const hasBottom = Boolean(socialSignal ?? resultContent ?? onAnswer)

  return (
    <article
      className={cn(
        'text-card-foreground rounded-2xl border transition-colors',
        toneClasses[tone],
        className
      )}
    >
      <div className="p-4 sm:p-5">
        {/* Header: metadata + overflow */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground text-xs leading-5 font-medium">
            {item.metadata}
          </p>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        {/* Category + question */}
        <div className="mt-3 space-y-2">
          {category ? (
            <p
              className={cn(
                'text-[0.68rem] font-semibold tracking-[0.18em] uppercase',
                categoryToneClasses[tone]
              )}
            >
              {category.toUpperCase()}
            </p>
          ) : null}
          <p className="text-foreground font-serif text-xl leading-8 sm:text-2xl sm:leading-9">
            {item.question}
          </p>
        </div>

        {item.personalMessage ? (
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            &ldquo;{item.personalMessage}&rdquo;
          </p>
        ) : null}
      </div>

      {/* Bottom strip */}
      {hasBottom ? (
        <div
          className={cn(
            'flex items-center gap-3 border-t px-4 py-3 sm:px-5',
            dividerToneClasses[tone]
          )}
        >
          {resultContent ? (
            <div className="flex-1 text-sm leading-6 text-stone-700">
              {resultContent}
            </div>
          ) : (
            <>
              {socialSignal ? (
                <p className="flex-1 text-sm text-stone-600 leading-5">
                  {socialSignal}
                </p>
              ) : (
                <div className="flex-1" />
              )}
              {onAnswer ? (
                <button
                  type="button"
                  onClick={onAnswer}
                  className="shrink-0 text-sm font-semibold text-stone-950 transition hover:opacity-70"
                >
                  Answer →
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  )
}
