import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

function Sparkle({
  size,
  className,
  opacity = 1,
}: {
  size: number
  className?: string
  opacity?: number
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('pointer-events-none absolute', className)}
      style={{ color: '#c79a4f', opacity }}
    >
      <path
        d="M12 0 C 12.4 5.6 18.4 11.6 24 12 C 18.4 12.4 12.4 18.4 12 24 C 11.6 18.4 5.6 12.4 0 12 C 5.6 11.6 11.6 5.6 12 0 Z"
        fill="currentColor"
      />
    </svg>
  )
}

type SparkleEnvelopeProps = {
  /** Cream label across the top of the dark ink frame. */
  eyebrow: ReactNode
  /** Category-derived accent color used for the inner kicker. */
  accent: string
  /** Small uppercase label at the top-left of the cream card. */
  kicker: ReactNode
  /** The attribution / "who and why" sentence under the kicker. */
  signal: ReactNode
  question: string
  timestamp?: string | null
  overflow?: ReactNode
  onAnswer?: () => void
  answerLabel?: string
  className?: string
}

/**
 * The "Handwritten" envelope shell: a dark ink frame matting a cream card
 * speckled with gold sparkles. Shared by the question-sharing feed cards
 * (FriendAddedCard, DirectSentCard) so the sparkle/frame markup lives in one
 * place — callers supply only the copy that differs between surfaces.
 */
export function SparkleEnvelope({
  eyebrow,
  accent,
  kicker,
  signal,
  question,
  timestamp,
  overflow,
  onAnswer,
  answerLabel = 'Answer this',
  className,
}: SparkleEnvelopeProps) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-[1.5rem] bg-[var(--ink)] p-[6px] shadow-[0_10px_24px_-8px_rgb(0_0_0/0.28)]',
        className,
      )}
    >
      <p
        className="px-3 pb-[10px] pt-[6px] text-[10px] font-bold uppercase leading-none tracking-[0.22em]"
        style={{ color: 'var(--cream)' }}
      >
        {eyebrow}
      </p>

      <div className="relative overflow-hidden rounded-[1.15rem] border border-[var(--border-warm)] bg-[var(--cream)] px-5 py-5 sm:px-7 sm:py-6">
        <Sparkle size={26} className="left-3 top-5 rotate-[8deg]" opacity={0.95} />
        <Sparkle size={14} className="left-7 top-14" opacity={0.7} />
        <Sparkle size={10} className="left-4 bottom-6" opacity={0.55} />

        <Sparkle size={22} className="right-4 top-12 -rotate-[6deg]" opacity={0.9} />
        <Sparkle size={12} className="right-9 top-4" opacity={0.6} />
        <Sparkle size={9} className="right-6 bottom-8" opacity={0.5} />

        <div className="relative pl-6 pr-4 sm:pl-10 sm:pr-8">
          <div className="flex items-start justify-between gap-3">
            <p
              className="text-[11px] font-bold uppercase leading-none tracking-[0.14em]"
              style={{ color: accent }}
            >
              {kicker}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {timestamp ? (
                <span
                  className="text-[11px] leading-none"
                  style={{ color: 'var(--ink)', opacity: 0.6 }}
                >
                  {timestamp}
                </span>
              ) : null}
              {overflow}
            </div>
          </div>

          <p
            className="mt-1.5 text-[14px] leading-snug"
            style={{ color: 'var(--ink)', opacity: 0.85 }}
          >
            {signal}
          </p>

          <div className="mt-4 flex items-center gap-4 sm:gap-5">
            <p
              className="min-w-0 flex-1 text-[19px] leading-snug text-[var(--ink)] sm:text-[22px]"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              <span aria-hidden className="opacity-60">&ldquo;</span>
              {question}
              <span aria-hidden className="opacity-60">&rdquo;</span>
            </p>

            {onAnswer ? (
              <button
                type="button"
                onClick={onAnswer}
                className="shrink-0 rounded-full bg-[#1d4ed8] px-5 py-2.5 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#1e40af] active:translate-y-px"
              >
                {answerLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
