import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
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
      {children ?? (
        <p>
          <PersonName href={item.friendHref} name={item.friendName} /> added a
          question to their bank.
        </p>
      )}
    </FeedCard>
  )
}
