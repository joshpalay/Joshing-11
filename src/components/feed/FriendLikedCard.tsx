import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
  actions?: ReactNode
  children?: ReactNode
}

export function FriendLikedCard({
  item,
  actions,
  children,
}: FriendLikedCardProps) {
  return (
    <FeedCard
      item={item}
      tone="white"
      eyebrow={<span>Friend liked</span>}
      actions={actions}
    >
      {children ?? <p>{item.friendName} liked this question.</p>}
    </FeedCard>
  )
}
