import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem } from './types'

type FriendAnsweredCardProps = {
  item: FriendAnsweredFeedItem
  actions?: ReactNode
  children?: ReactNode
}

export function FriendAnsweredCard({
  item,
  actions,
  children,
}: FriendAnsweredCardProps) {
  const tone = item.friendCorrect ? 'green' : 'white'

  return (
    <FeedCard
      item={item}
      tone={tone}
      eyebrow={<span>Friend answered</span>}
      actions={actions}
    >
      {children ?? (
        <p>
          {item.answerSummary ?? `${item.friendName} answered this question.`}
        </p>
      )}
    </FeedCard>
  )
}
