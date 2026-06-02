import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
}

export function FriendLikedCard({ item, overflow, onAnswer, onDismiss }: FriendLikedCardProps) {
  const merged: FriendLikedFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.friendName,
    authorHref: item.authorHref ?? item.friendHref ?? null,
  }
  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={onAnswer}
      onDismiss={onDismiss}
      verb="thought you would like this"
    />
  )
}
