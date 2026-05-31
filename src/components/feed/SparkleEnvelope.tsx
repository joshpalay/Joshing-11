import type { ReactNode } from 'react'

import { FeedActionLink } from './FeedActionLink'
import { FeedCardShell } from './FeedCardShell'

type SparkleEnvelopeProps = {
  /** Attribution line — e.g. "<actor> thought you'd like this about <category>." */
  signal: ReactNode
  question: string
  overflow?: ReactNode
  onAnswer?: () => void
  answerLabel?: string
  className?: string
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
  answerLabel = 'Answer →',
  className,
}: SparkleEnvelopeProps) {
  return (
    <FeedCardShell variant="triangle" className={className}>
      <div className="flex flex-col items-center gap-5 p-[14px]">
        <div className="flex w-full items-start justify-between gap-3">
          <p className="font-sans text-[15px] leading-[23px] tracking-[0.05em] text-black">
            {signal}
          </p>
          {overflow ? <div className="shrink-0">{overflow}</div> : null}
        </div>

        <div aria-hidden className="h-px w-[70px] bg-[var(--brand-rule)]" />

        <div className="flex w-full flex-col items-end gap-5">
          <p className="w-full font-serif text-[24px] font-semibold leading-[32px] tracking-[0.05em] text-[var(--brand-ink)]">
            <span aria-hidden className="opacity-60">
              &ldquo;
            </span>
            {question}
            <span aria-hidden className="opacity-60">
              &rdquo;
            </span>
          </p>

          {onAnswer ? (
            <FeedActionLink onClick={onAnswer}>{answerLabel}</FeedActionLink>
          ) : null}
        </div>
      </div>
    </FeedCardShell>
  )
}
