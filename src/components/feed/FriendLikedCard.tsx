import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  onDismiss?: () => void
  onViewAnswer?: () => void
  revealedAnswer?: ReactNode
  viaAttribution?: ReactNode
  discoveryAttribution?: ReactNode
  elevated?: boolean
}

export function FriendLikedCard({ item, overflow, onAnswer, onDismiss, onViewAnswer, revealedAnswer, viaAttribution, discoveryAttribution, elevated }: FriendLikedCardProps) {
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
      onViewAnswer={onViewAnswer}
      revealedAnswer={revealedAnswer}
      verb="thought you would like this"
      viaAttribution={viaAttribution}
      discoveryAttribution={discoveryAttribution}
      elevated={elevated}
    />
  )
}
