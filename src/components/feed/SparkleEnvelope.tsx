import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { FeedActionLink } from './FeedActionLink'
import { FeedCardShell } from './FeedCardShell'
import { FeedDismissButton } from './FeedDismissButton'

type SparkleEnvelopeProps = {
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
   * Card chrome. 'triangle' (default) mats the question on the app triangle
   * pattern — the "sent directly to you" treatment. 'bordered' is the plain
   * hairline-border tile used for broadcasts ("shared a question about"). Both
   * keep the identical inner layout (divider, dismiss, Answer link).
   */
  variant?: 'triangle' | 'bordered'
  /** Tier 1 "playable" lift on the unified home feed. Forwarded to FeedCardShell. */
  elevated?: boolean
}

/**
 * The "shared with you" feed card (DirectSentCard, FriendAddedCard), built to
 * the Figma triangle-bordered design (frame 137:5911): the app triangle pattern
 * mats a cream card with a grey rule, a focal serif question, and an "Answer →"
 * link. The pattern is the same /images/Variant4.png used on the login/home
 * triangle banner, so the motif and scale stay consistent across surfaces.
 */
export function SparkleEnvelope({
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
          <p className="font-sans text-[15px] leading-[23px] tracking-[0.05em] text-[var(--brand-ink)]">
            {signal}
          </p>
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
