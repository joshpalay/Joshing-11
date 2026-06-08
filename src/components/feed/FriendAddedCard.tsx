import type { ReactNode } from 'react'
import Link from 'next/link'

import { visibleFeedCategory } from './category'
import { SparkleEnvelope } from './SparkleEnvelope'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
  onHideCategory?: () => void
  className?: string
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  onDismiss,
  onHideCategory,
  className,
}: FriendAddedCardProps) {
  const visibleCategory = visibleFeedCategory(item.category)
  const friendName = item.friendName || item.avatarName || 'A friend'
  const friendHref = item.friendHref ?? item.authorHref ?? null

  const signal = (
    <>
      {friendHref ? (
        <Link href={friendHref} className="font-semibold text-[var(--brand-link)] hover:opacity-70">
          {friendName}
        </Link>
      ) : (
        <span className="font-semibold text-[var(--brand-link)]">{friendName}</span>
      )}{' '}
      added a question
      {visibleCategory ? <> about {visibleCategory}</> : null}
      {visibleCategory && onHideCategory ? (
        <>
          <span className="mx-1.5 opacity-50">·</span>
          <button
            type="button"
            onClick={onHideCategory}
            className="font-medium text-[var(--brand-link)] hover:underline"
          >
            Hide questions about {visibleCategory}
          </button>
        </>
      ) : null}
    </>
  )

  return (
    <SparkleEnvelope
      // Broadcasts render on the plain hairline-bordered tile (Figma Frame 2),
      // not the triangle mat — that motif is reserved for direct sends.
      variant="bordered"
      signal={signal}
      question={item.question}
      overflow={overflow}
      // You can't answer your own question — suppress the action on authored cards.
      onAnswer={item.viewerIsAuthor ? undefined : onAnswer}
      onDismiss={item.viewerIsAuthor ? undefined : onDismiss}
      className={className}
    />
  )
}
