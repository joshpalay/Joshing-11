import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { FeedActionLink } from './FeedActionLink'
import { FeedCardShell } from './FeedCardShell'
import { FeedDismissButton } from './FeedDismissButton'

type SparkleEnvelopeProps = {
  /** Small-caps line above the attribution — e.g. "Sent directly to you". */
  eyebrow?: ReactNode
  /**
   * Color/weight override for the eyebrow. Defaults to the quiet muted-ink
   * register; "Sent directly to you" passes the gold accent so the direct-send
   * marker reads in the brand gold.
   */
  eyebrowClassName?: string
  /** Attribution line — e.g. "<actor> thought you'd like this about <category>." */
  signal: ReactNode
  question: string
  overflow?: ReactNode
  onAnswer?: () => void
  /** Quiet, secondary dismiss control (bottom-left, opposite Answer). View-state only. */
  onDismiss?: () => void
  answerLabel?: string
  className?: string
  /**
   * Card chrome. 'bordered' is the plain hairline-border tile both feed cards
   * (direct sends and broadcasts) now use; direct sends are distinguished by
   * the "Sent directly to you" eyebrow instead of the chrome. 'triangle'
   * (default for back-compat) mats the question on the app triangle pattern —
   * retired from the feed but kept in FeedCardShell. Both keep the identical
   * inner layout (divider, dismiss, Answer link).
   */
  variant?: 'triangle' | 'bordered'
  /** Tier 1 "playable" lift on the unified home feed. Forwarded to FeedCardShell. */
  elevated?: boolean
}

/**
 * The "shared with you" feed card (DirectSentCard, FriendAddedCard): a cream
 * card with a grey rule, a focal serif question, and an "Answer →" link, with
 * an optional small-caps eyebrow ("Sent directly to you") above the
 * attribution. Originally built to the Figma triangle-bordered design (frame
 * 137:5911) — that mat survives as the 'triangle' variant but the feed now
 * renders both card types on the plain bordered tile.
 */
export function SparkleEnvelope({
  eyebrow,
  eyebrowClassName = 'text-[var(--brand-ink)] opacity-70',
  signal,
  question,
  overflow,
  onAnswer,
  onDismiss,
  answerLabel = 'Answer →',
  className,
  variant = 'triangle',
  elevated = false,
}: SparkleEnvelopeProps) {
  return (
    <FeedCardShell variant={variant} className={className} elevated={elevated}>
      <div className="flex flex-col items-center gap-5 p-[14px]">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              // Same small-caps eyebrow rhythm as the AnsweredByYouCard header.
              <p
                className={cn(
                  'mb-2 text-[11px] uppercase leading-none tracking-[0.08em]',
                  eyebrowClassName,
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            <p className="font-sans text-[15px] leading-[23px] tracking-[0.05em] text-[var(--brand-ink)]">
              {signal}
            </p>
          </div>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        <div aria-hidden className="h-px w-[70px] bg-[var(--brand-rule)]" />

        <div className="flex w-full flex-col items-end gap-5">
          <p className="w-full font-serif text-2xl font-semibold leading-[32px] tracking-[0.05em] text-[var(--brand-ink)]">
            <span aria-hidden className="opacity-60">
              &ldquo;
            </span>
            {question}
            <span aria-hidden className="opacity-60">
              &rdquo;
            </span>
          </p>

          {onAnswer || onDismiss ? (
            <div
              className={cn(
                'flex w-full items-center gap-3',
                onDismiss ? 'justify-between' : 'justify-end',
              )}
            >
              {onDismiss ? <FeedDismissButton onClick={onDismiss} /> : null}
              {onAnswer ? (
                <FeedActionLink onClick={onAnswer}>{answerLabel}</FeedActionLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </FeedCardShell>
  )
}
