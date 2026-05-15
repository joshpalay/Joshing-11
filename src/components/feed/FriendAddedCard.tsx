import type { ReactNode } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

import { visibleFeedCategory } from './category'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  resultContent?: ReactNode
  className?: string
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn('text-amber-400/70', className)}
    >
      <path
        d="M12 2 L13.6 8.6 L20 10 L13.6 11.4 L12 18 L10.4 11.4 L4 10 L10.4 8.6 Z"
        fill="currentColor"
      />
      <circle cx="20" cy="4" r="1.2" fill="currentColor" opacity="0.6" />
      <circle cx="4" cy="20" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function PersonName({ href, name }: { href?: string | null; name: string }) {
  if (!href) return <>{name}</>
  return (
    <Link
      href={href}
      className="font-medium text-stone-950 underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  )
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  resultContent,
  className,
}: FriendAddedCardProps) {
  const category = visibleFeedCategory(item.category)

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-[#fff8e3] via-[#fff4d0] to-[#fdebb8] text-stone-900 shadow-[0_2px_12px_rgba(154,109,24,0.10)]',
        className
      )}
    >
      <Sparkle className="pointer-events-none absolute top-3 left-3 h-5 w-5" />
      <Sparkle className="pointer-events-none absolute top-10 right-12 h-3 w-3 opacity-60" />
      <Sparkle className="pointer-events-none absolute bottom-16 left-8 h-4 w-4 opacity-50" />
      <Sparkle className="pointer-events-none absolute right-4 bottom-4 h-6 w-6" />

      <div className="relative p-4 pl-10 sm:p-5 sm:pl-12">
        {/* Header: metadata + overflow */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs leading-5 font-medium text-amber-900/70">
            {item.metadata}
          </p>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        {/* Kicker: NEW QUESTION · CATEGORY */}
        <p className="mt-3 text-[0.68rem] font-semibold tracking-[0.18em] text-amber-700 uppercase">
          New question
          {category ? (
            <>
              <span className="mx-1.5 text-amber-700/40">·</span>
              {category.toUpperCase()}
            </>
          ) : null}
        </p>

        {/* Question */}
        <p className="text-foreground mt-2 font-serif text-xl leading-8 sm:text-2xl sm:leading-9">
          {item.question}
        </p>

        {/* Friend attribution */}
        <p className="mt-3 text-sm leading-6 text-stone-700">
          <PersonName href={item.friendHref} name={item.friendName} /> added this
          to their bank — be the first to take it on.
        </p>

        {item.personalMessage ? (
          <p className="mt-2 text-sm leading-6 text-stone-600 italic">
            &ldquo;{item.personalMessage}&rdquo;
          </p>
        ) : null}
      </div>

      {/* Bottom strip: result OR CTA */}
      {resultContent ? (
        <div className="relative border-t border-amber-200/60 px-4 py-3 text-sm leading-6 text-stone-700 sm:px-5">
          {resultContent}
        </div>
      ) : onAnswer ? (
        <div className="relative border-t border-amber-200/60 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onAnswer}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Answer this
            <span aria-hidden>→</span>
          </button>
        </div>
      ) : null}
    </article>
  )
}
