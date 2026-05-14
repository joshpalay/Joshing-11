import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  actions?: ReactNode
  children?: ReactNode
}

export function FriendAddedCard({
  item,
  actions,
  children,
}: FriendAddedCardProps) {
  return (
    <FeedCard
      item={item}
      tone="amber"
      eyebrow={<span>New question</span>}
      actions={actions}
    >
      {children ?? <p>{item.friendName} added a question to their bank.</p>}
    </FeedCard>
  )
}
