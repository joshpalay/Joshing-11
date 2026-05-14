import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
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
      {children ?? (
        <p>
          <PersonName href={item.senderHref} name={item.senderName} /> thought
          you would like this one.
        </p>
      )}
    </FeedCard>
  )
}
