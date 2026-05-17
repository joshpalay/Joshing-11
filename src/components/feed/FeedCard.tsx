import { cn } from '@/lib/utils'

import type { FeedCardShellProps } from './types'

const AVATAR_COLORS = ['#0f766e', '#7c3aed', '#be123c', '#2563eb', '#b45309', '#15803d']
const CATEGORY_COLORS = ['#0f766e', '#7c3aed', '#be123c', '#2563eb', '#b45309', '#15803d', '#c2410c', '#0369a1']

function hashString(str: string): number {
  return Array.from(str).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function colorForUser(userId?: string | null): string {
  if (!userId) return '#9ca3af'
  return AVATAR_COLORS[hashString(userId) % AVATAR_COLORS.length]!
}

function colorForCategory(category?: string | null): string {
  if (!category) return '#e5e7eb'
  return CATEGORY_COLORS[hashString(category.toLowerCase()) % CATEGORY_COLORS.length]!
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

export function FeedCard({
  item,
  socialSignal,
  overflow,
  onAnswer,
  resultContent,
  className,
  dimQuestion,
}: FeedCardShellProps) {
  const hasBottom = Boolean(resultContent ?? onAnswer)

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border border-stone-200 bg-white transition-colors',
        className
      )}
      style={{ borderLeftWidth: '4px', borderLeftColor: colorForCategory(item.category) }}
    >
      <div className="p-3 pl-4">
        {/* Header: avatar + social signal + overflow */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {item.avatarName ? (
              <div
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: colorForUser(item.avatarUserId) }}
              >
                {initialsFor(item.avatarName)}
              </div>
            ) : null}
            {socialSignal ? (
              <p className="text-sm font-medium leading-5 text-stone-700">
                {socialSignal}
              </p>
            ) : null}
          </div>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        {/* Question */}
        <div className={cn('mt-2', item.avatarName ? 'pl-[2.625rem]' : '')}>
          <p
            className={cn(
              'font-serif text-base leading-6',
              dimQuestion ? 'text-stone-400' : 'text-foreground'
            )}
          >
            {item.question}
          </p>
        </div>

        {item.personalMessage ? (
          <p
            className={cn(
              'text-muted-foreground mt-2 text-sm leading-6',
              item.avatarName ? 'pl-[2.625rem]' : ''
            )}
          >
            &ldquo;{item.personalMessage}&rdquo;
          </p>
        ) : null}
      </div>

      {/* Bottom strip */}
      {hasBottom ? (
        <div className="flex items-center gap-3 border-t border-stone-200 px-3 py-2.5">
          {resultContent ? (
            <div className="flex-1 text-sm leading-6 text-stone-700">{resultContent}</div>
          ) : (
            <>
              <div className="flex-1" />
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
