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

export function FeedCard({
  item,
  tone,
  eyebrow,
  children,
  actions,
  className,
}: FeedCardShellProps) {
  const category = visibleFeedCategory(item.category)

  return (
    <article
      className={cn(
        'text-card-foreground rounded-2xl border p-4 transition-colors sm:p-5',
        toneClasses[tone],
        className
      )}
    >
      <div className="space-y-3">
        <div className="text-muted-foreground flex items-start justify-between gap-3 text-xs leading-5 font-medium">
          <p>{item.metadata}</p>
          {eyebrow ? (
            <div className="shrink-0 text-right">{eyebrow}</div>
          ) : null}
        </div>

        <div className="space-y-2">
          {category ? (
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-stone-500 uppercase">
              {category.toUpperCase()}
            </p>
          ) : null}
          <p className="text-foreground font-serif text-xl leading-8 sm:text-2xl sm:leading-9">
            {item.question}
          </p>
        </div>

        {item.personalMessage ? (
          <p className="text-muted-foreground text-sm leading-6">
            &ldquo;{item.personalMessage}&rdquo;
          </p>
        ) : null}

        {children ? (
          <div className="pt-1 text-sm leading-6 text-stone-700">
            {children}
          </div>
        ) : null}
        {actions ? <div className="pt-2">{actions}</div> : null}
      </div>
    </article>
  )
}
