import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
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
      {children ?? (
        <p>
          <PersonName href={item.friendHref} name={item.friendName} /> liked
          this question.
        </p>
      )}
    </FeedCard>
  )
}
