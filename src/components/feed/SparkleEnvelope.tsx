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
  /**
   * "View Answer" — a quiet secondary link sitting next to Dismiss (divided by a
   * pipe) that reveals the correct answer inline without dismissing the card.
   * The revealed answer is rendered via `revealedAnswer`. View-state only.
   */
  onViewAnswer?: () => void
  /** The revealed answer node, shown above the actions once View Answer is tapped. */
  revealedAnswer?: ReactNode
  answerLabel?: string
  /** Render the answer action as a filled primary button (used by direct sends) instead of the inline text link. */
  answerAsButton?: boolean
  /**
   * B-VIA-ATTRIBUTION-01: the "Via [friend]" answerer line, rendered above the
   * Answer action. The answerer fact, distinct from the question's authorship
   * (the `signal` line) — they coexist on different fields and never collide.
   */
  viaAttribution?: ReactNode
  /**
   * D-4 via-attribution: the "by {author}" / "via {source}" stranger-discovery
   * affordance, rendered just under the attribution signal (the byline) rather
   * than at the bottom — it names who wrote it / who it came via, a header fact.
   */
  discoveryAttribution?: ReactNode
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
  onViewAnswer,
  revealedAnswer,
  answerLabel = 'Answer →',
  answerAsButton = false,
  viaAttribution,
  discoveryAttribution,
  className,
  variant = 'triangle',
  elevated = false,
}: SparkleEnvelopeProps) {
  return (
    <FeedCardShell variant={variant} className={className} elevated={elevated}>
      <div className="flex flex-col items-center gap-5 p-3.5">
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
            {discoveryAttribution ? <div className="mt-1.5">{discoveryAttribution}</div> : null}
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

          {viaAttribution ? (
            <div className="w-full text-left">{viaAttribution}</div>
          ) : null}

          {revealedAnswer ? (
            <div className="w-full text-left">{revealedAnswer}</div>
          ) : null}

          {onAnswer || onDismiss || onViewAnswer ? (
            <div
              className={cn(
                'flex w-full items-center gap-3',
                onDismiss || onViewAnswer ? 'justify-between' : 'justify-end',
              )}
            >
              {onDismiss || onViewAnswer ? (
                <div className="flex items-center gap-2">
                  {onDismiss ? <FeedDismissButton onClick={onDismiss} /> : null}
                  {onDismiss && onViewAnswer ? (
                    <span aria-hidden className="text-muted-foreground/50 text-sm">
                      |
                    </span>
                  ) : null}
                  {onViewAnswer ? (
                    <FeedActionLink onClick={onViewAnswer} size="sm">
                      View Answer
                    </FeedActionLink>
                  ) : null}
                </div>
              ) : null}
              {onAnswer ? (
                answerAsButton ? (
                  <button type="button" onClick={onAnswer} className="btn-primary">
                    Answer
                  </button>
                ) : (
                  <FeedActionLink onClick={onAnswer}>{answerLabel}</FeedActionLink>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </FeedCardShell>
  )
}
