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
  viaAttribution?: ReactNode
  discoveryAttribution?: ReactNode
  className?: string
  elevated?: boolean
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  onDismiss,
  viaAttribution,
  discoveryAttribution,
  className,
  elevated,
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
    </>
  )

  return (
    <SparkleEnvelope
      // Plain hairline-bordered tile (Figma Frame 2) — the same chrome as
      // direct sends, which carry the "Sent directly to you" eyebrow instead.
      variant="bordered"
      signal={signal}
      question={item.question}
      overflow={overflow}
      // You can't answer your own question — suppress the action on authored cards.
      onAnswer={item.viewerIsAuthor ? undefined : onAnswer}
      // Present Answer as a filled primary button, matching the direct-send card.
      answerAsButton
      onDismiss={item.viewerIsAuthor ? undefined : onDismiss}
      viaAttribution={viaAttribution}
      discoveryAttribution={discoveryAttribution}
      className={className}
      elevated={elevated}
    />
  )
}
