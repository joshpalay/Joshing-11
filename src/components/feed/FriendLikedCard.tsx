import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
  viaAttribution?: ReactNode
  discoveryAttribution?: ReactNode
  elevated?: boolean
}

export function FriendLikedCard({ item, overflow, onAnswer, onDismiss, viaAttribution, discoveryAttribution, elevated }: FriendLikedCardProps) {
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
      viaAttribution={viaAttribution}
      discoveryAttribution={discoveryAttribution}
      elevated={elevated}
    />
  )
}
