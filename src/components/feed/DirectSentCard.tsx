import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  actions?: ReactNode
  children?: ReactNode
}

export function DirectSentCard({
  item,
  actions,
  children,
}: DirectSentCardProps) {
  return (
    <FeedCard
      item={item}
      tone="cream"
      eyebrow={<span>For you</span>}
      actions={actions}
    >
      {children ?? <p>{item.senderName} thought you would like this one.</p>}
    </FeedCard>
  )
}
