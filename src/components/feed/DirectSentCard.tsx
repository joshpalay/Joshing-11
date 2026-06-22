import type { ReactNode } from 'react'
import Link from 'next/link'

import { HourglassMark } from '@/components/activity/ActivityIcon'

import { SparkleEnvelope } from './SparkleEnvelope'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
  viaAttribution?: ReactNode
  discoveryAttribution?: ReactNode
  elevated?: boolean
}

export function DirectSentCard({ item, overflow, onAnswer, onDismiss, viaAttribution, discoveryAttribution, elevated }: DirectSentCardProps) {
  const senderName = item.senderName || item.avatarName || 'A friend'
  const senderHref = item.senderHref ?? item.authorHref ?? null
  const authoredBySender = item.authoredBySender === true

  // Single left-aligned signal row: one hourglass (reinforcement on the text
  // line, never the sole carrier of "directed"), the sender, then the verb
  // clause. Honest attribution — "question they wrote" only on the authored
  // path; curated sends get the plain "sent you this" (B-DIRECTSENT-SIMPLIFY-01).
  // The category is deliberately omitted from this header (B-category-removal-josh).
  const signal = (
    <>
      <span className="inline-flex items-center gap-2">
        <HourglassMark />
        <span>
          {senderHref ? (
            <Link href={senderHref} className="font-semibold text-[var(--brand-link)] hover:opacity-70">
              {senderName}
            </Link>
          ) : (
            <span className="font-semibold text-[var(--brand-link)]">{senderName}</span>
          )}{' '}
          {authoredBySender ? (
            <>
              sent you a{' '}
              {/* Teal reinforces the words, which already carry the meaning —
                  reuse the hourglass's teal token, never a hex literal. */}
              <span className="text-[var(--tri-darkteal)]">question they wrote</span>
            </>
          ) : (
            <>sent you this</>
          )}
        </span>
      </span>
      {item.personalMessage ? (
        <span className="mt-1 block font-serif text-sm italic leading-snug text-[var(--brand-ink-700)]">
          &ldquo;{item.personalMessage}&rdquo;
        </span>
      ) : null}
    </>
  )

  return (
    <SparkleEnvelope
      // Direct sends share the plain hairline-bordered tile with broadcasts
      // (the triangle mat is retired); the signal row carries the directed cue.
      variant="bordered"
      signal={signal}
      question={item.question}
      overflow={overflow}
      onAnswer={item.viewerIsAuthor ? undefined : onAnswer}
      // Direct sends present Answer as a filled primary button (not the inline link).
      answerAsButton
      onDismiss={item.viewerIsAuthor ? undefined : onDismiss}
      // Directed wins: the "Sent directly to you" attribution leads; the "Via"
      // answerer line renders below it and must not compete with the sender.
      viaAttribution={viaAttribution}
      discoveryAttribution={discoveryAttribution}
      elevated={elevated}
    />
  )
}
