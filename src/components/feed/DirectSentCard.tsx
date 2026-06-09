import type { ReactNode } from 'react'
import Link from 'next/link'

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
      signal={signal}
      question={item.question}
      overflow={overflow}
      onAnswer={item.viewerIsAuthor ? undefined : onAnswer}
      onDismiss={item.viewerIsAuthor ? undefined : onDismiss}
      elevated={elevated}
    />
  )
}
