import type { ReactNode } from 'react'
import Link from 'next/link'

import { visibleFeedCategory } from './category'
import { SparkleEnvelope } from './SparkleEnvelope'
import type { FriendAddedFeedItem } from './types'
import { colorForCategory } from './visual'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onHideCategory?: () => void
  className?: string
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  onHideCategory,
  className,
}: FriendAddedCardProps) {
  const visibleCategory = visibleFeedCategory(item.category)
  const accent = colorForCategory(item.category)
  const friendName = item.friendName || item.avatarName || 'A friend'
  const friendHref = item.friendHref ?? item.authorHref ?? null

  const eyebrow = (
    <>
      Handwritten <span className="opacity-50">·</span> By {friendName}
    </>
  )

  const kicker = (
    <>
      New question
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
      {friendHref ? (
        <Link
          href={friendHref}
          className="font-semibold text-[var(--ink)] underline underline-offset-2"
          style={{ textDecorationColor: 'rgb(0 0 0 / 0.3)' }}
        >
          {friendName}
        </Link>
      ) : (
        <span className="font-semibold text-[var(--ink)]">{friendName}</span>
      )}{' '}
      added a question
      {visibleCategory ? <> about {visibleCategory}</> : null}
      {visibleCategory && onHideCategory ? (
        <>
          <span className="mx-1.5 opacity-50">·</span>
          <button
            type="button"
            onClick={onHideCategory}
            className="font-medium text-[#1d4ed8] hover:underline"
          >
            Hide questions about {visibleCategory}
          </button>
        </>
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
      className={className}
    />
  )
}
