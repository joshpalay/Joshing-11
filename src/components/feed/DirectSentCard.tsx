import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
}

export function DirectSentCard({ item, overflow, onAnswer }: DirectSentCardProps) {
  const merged: DirectSentFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.senderName,
    authorHref: item.authorHref ?? item.senderHref ?? null,
  }
  return <FeedCard item={merged} overflow={overflow} onAnswer={onAnswer} />
}
