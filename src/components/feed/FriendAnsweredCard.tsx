import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem } from './types'

type FriendAnsweredCardProps = {
  item: FriendAnsweredFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
}

export function FriendAnsweredCard({
  item,
  overflow,
  onAnswer,
}: FriendAnsweredCardProps) {
  const viewerAnswered =
    item.viewerResult !== null && item.viewerResult !== undefined
  const merged: FriendAnsweredFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.friendName,
    authorHref: item.authorHref ?? item.friendHref ?? null,
  }
  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={viewerAnswered ? undefined : onAnswer}
    />
  )
}
