import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem } from './types'

type FriendAnsweredCardProps = {
  item: FriendAnsweredFeedItem
  actions?: ReactNode
  children?: ReactNode
}

function PersonName({ href, name }: { href?: string | null; name: string }) {
  if (!href) return <>{name}</>
  return (
    <Link
      href={href}
      className="font-medium underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  )
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
      {children ??
        (item.answerSummary ? (
          <p>{item.answerSummary}</p>
        ) : (
          <p>
            <PersonName href={item.friendHref} name={item.friendName} />{' '}
            answered this question.
          </p>
        ))}
    </FeedCard>
  )
}
