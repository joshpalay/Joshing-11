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

function endorsementCopy(item: FriendLikedFeedItem) {
  const count = item.endorsementCount ?? 1
  if (count <= 1) {
    return (
      <p>
        <PersonName href={item.friendHref} name={item.friendName} /> liked this
        question.
      </p>
    )
  }

  const names = item.additionalEndorsers
    ?.map((endorser) => endorser.displayName)
    .filter(Boolean)
  const suffix = names?.length ? ` with ${names.join(', ')}` : ''

  return (
    <p>
      <PersonName href={item.friendHref} name={item.friendName} /> and{' '}
      {count - 1} {count - 1 === 1 ? 'friend' : 'friends'} liked this question
      {suffix}.
    </p>
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
      {children ?? endorsementCopy(item)}
    </FeedCard>
  )
}
