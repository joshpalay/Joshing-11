import type { ReactNode } from 'react'
import Link from 'next/link'

import { HourglassMark } from '@/components/activity/ActivityIcon'

import { visibleFeedCategory } from './category'
import { SparkleEnvelope } from './SparkleEnvelope'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
  elevated?: boolean
}

export function DirectSentCard({ item, overflow, onAnswer, onDismiss, elevated }: DirectSentCardProps) {
  const visibleCategory = visibleFeedCategory(item.category)
  const senderName = item.senderName || item.avatarName || 'A friend'
  const senderHref = item.senderHref ?? item.authorHref ?? null

  // Figma header line: actor in the link slate, the rest in black, with the
  // optional personal note in italic serif beneath.
  const signal = (
    <>
      {senderHref ? (
        <Link href={senderHref} className="font-semibold text-[var(--brand-link)] hover:opacity-70">
          {senderName}
        </Link>
      ) : (
        <span className="font-semibold text-[var(--brand-link)]">{senderName}</span>
      )}{' '}
      thought you&rsquo;d like this
      {visibleCategory ? <> about {visibleCategory}</> : null}.
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
      // (the triangle mat is retired); the eyebrow is what marks them out.
      variant="bordered"
      // Centered flourish mirroring the milestone "star — line — star"
      // treatment (MilestoneStar): a pair of hourglass marks flanks the eyebrow.
      // The hourglass is the triangle family's "someone sends you a Q" sign, so
      // it carries the direct-send meaning without spending the gold accent
      // (reserved per STYLE-GUIDE-COLOR §4). Text stays in the quiet ink register
      // (opacity on the text span only, so the marks keep their 80% fill).
      eyebrow={
        <span className="inline-flex items-center gap-3">
          <HourglassMark />
          <span className="opacity-70">Sent directly to you</span>
          <HourglassMark />
        </span>
      }
      eyebrowClassName="flex justify-center font-semibold text-[var(--brand-ink)]"
      signal={signal}
      question={item.question}
      overflow={overflow}
      onAnswer={item.viewerIsAuthor ? undefined : onAnswer}
      onDismiss={item.viewerIsAuthor ? undefined : onDismiss}
      elevated={elevated}
    />
  )
}
