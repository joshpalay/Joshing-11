import type { ReactNode } from 'react'
import Link from 'next/link'

import { visibleFeedCategory } from './category'
import { SparkleEnvelope } from './SparkleEnvelope'
import type { DirectSentFeedItem } from './types'
import { colorForCategory } from './visual'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
}

export function DirectSentCard({ item, overflow, onAnswer }: DirectSentCardProps) {
  const visibleCategory = visibleFeedCategory(item.category)
  const accent = colorForCategory(item.category)
  const senderName = item.senderName || item.avatarName || 'A friend'
  const senderHref = item.senderHref ?? item.authorHref ?? null

  const eyebrow = (
    <>
      Sent to you <span className="opacity-50">·</span> From {senderName}
    </>
  )

  const kicker = (
    <>
      For you
      {visibleCategory ? (
        <>
          <span className="mx-1.5 opacity-60">·</span>
          {visibleCategory}
        </>
      ) : null}
    </>
  )

  const signal = (
    <>
      {senderHref ? (
        <Link
          href={senderHref}
          className="font-semibold text-[var(--ink)] underline underline-offset-2"
          style={{ textDecorationColor: 'rgb(0 0 0 / 0.3)' }}
        >
          {senderName}
        </Link>
      ) : (
        <span className="font-semibold text-[var(--ink)]">{senderName}</span>
      )}{' '}
      thought you&rsquo;d like this
      {visibleCategory ? <> about {visibleCategory}</> : null}.
      {item.personalMessage ? (
        <span
          className="mt-1 block italic"
          style={{ fontFamily: 'var(--font-cormorant, Georgia), "Times New Roman", serif', opacity: 0.9 }}
        >
          &ldquo;{item.personalMessage}&rdquo;
        </span>
      ) : null}
    </>
  )

  return (
    <SparkleEnvelope
      eyebrow={eyebrow}
      accent={accent}
      kicker={kicker}
      signal={signal}
      question={item.question}
      timestamp={item.timestamp}
      overflow={overflow}
      onAnswer={onAnswer}
    />
  )
}
