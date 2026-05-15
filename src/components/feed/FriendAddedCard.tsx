import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendAddedFeedItem } from './types'

type FriendAddedCardProps = {
  item: FriendAddedFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
  resultContent?: ReactNode
}

function PersonName({ href, name }: { href?: string | null; name: string }) {
  if (!href) return <>{name}</>
  return (
    <Link href={href} className="font-medium underline-offset-2 hover:underline">
      {name}
    </Link>
  )
}

export function FriendAddedCard({
  item,
  overflow,
  onAnswer,
  resultContent,
}: FriendAddedCardProps) {
  const socialSignal: ReactNode = (
    <>
      <PersonName href={item.friendHref} name={item.friendName} /> added a
      question to their bank.
    </>
  )

  return (
    <FeedCard
      item={item}
      tone="amber"
      socialSignal={socialSignal}
      overflow={overflow}
      onAnswer={onAnswer}
      resultContent={resultContent}
    />
  )
}
