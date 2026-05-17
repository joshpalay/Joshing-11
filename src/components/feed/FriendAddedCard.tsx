import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  className?: string
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  className,
}: FriendAddedCardProps) {
  const merged: FriendAddedFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.friendName,
    authorHref: item.authorHref ?? item.friendHref ?? null,
  }
  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={onAnswer}
      className={className}
    />
  )
}
