import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  resultContent?: ReactNode
  className?: string
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
  overflow,
  onAnswer,
  resultContent,
  className,
}: FriendAddedCardProps) {
  const category = visibleFeedCategory(item.category)
  const categoryClause = category ? <> about {category}</> : null

  const socialSignal: ReactNode = (
    <>
      <PersonName href={item.friendHref} name={item.friendName} /> added a
      question{categoryClause}.
    </>
  )

  return (
    <FeedCard
      item={item}
      tone="white"
      socialSignal={socialSignal}
      overflow={overflow}
      onAnswer={onAnswer}
      resultContent={resultContent}
      className={className}
    />
  )
}
