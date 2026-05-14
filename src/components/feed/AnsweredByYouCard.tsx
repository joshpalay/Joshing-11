import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { AnsweredByYouFeedItem } from './types'

type AnsweredByYouCardProps = {
  item: AnsweredByYouFeedItem
  actions?: ReactNode
  children?: ReactNode
}

export function AnsweredByYouCard({
  item,
  actions,
  children,
}: AnsweredByYouCardProps) {
  return (
    <FeedCard
      item={item}
      tone="gray"
      eyebrow={<span>{item.resultLabel ?? 'Answered'}</span>}
      actions={actions}
    >
      {children ?? (item.answerSummary ? <p>{item.answerSummary}</p> : null)}
    </FeedCard>
  )
}
