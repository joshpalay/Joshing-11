import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendLikedFeedItem } from './types'

type FriendLikedCardProps = {
  item: FriendLikedFeedItem
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

function endorsementSignal(item: FriendLikedFeedItem): ReactNode {
  const count = item.endorsementCount ?? 1
  if (count <= 1) {
    return (
      <>
        <PersonName href={item.friendHref} name={item.friendName} /> liked this
        question.
      </>
    )
  }
  const names = item.additionalEndorsers
    ?.map((e) => e.displayName)
    .filter(Boolean)
  const suffix = names?.length ? ` with ${names.join(', ')}` : ''
  return (
    <>
      <PersonName href={item.friendHref} name={item.friendName} /> and{' '}
      {count - 1} {count - 1 === 1 ? 'friend' : 'friends'} liked this
      {suffix}.
    </>
  )
}

export function FriendLikedCard({
  item,
  overflow,
  onAnswer,
  resultContent,
}: FriendLikedCardProps) {
  return (
    <FeedCard
      item={item}
      tone="white"
      socialSignal={endorsementSignal(item)}
      overflow={overflow}
      onAnswer={onAnswer}
      resultContent={resultContent}
    />
  )
}
