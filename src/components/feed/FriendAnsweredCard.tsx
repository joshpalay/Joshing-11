import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem } from './types'

type FriendAnsweredCardProps = {
  item: FriendAnsweredFeedItem
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

export function FriendAnsweredCard({
  item,
  overflow,
  onAnswer,
  resultContent,
}: FriendAnsweredCardProps) {
  const tone = item.friendCorrect ? 'green' : 'white'
  const socialSignal: ReactNode = item.answerSummary ?? (
    <>
      <PersonName href={item.friendHref} name={item.friendName} /> answered this.
    </>
  )

  return (
    <FeedCard
      item={item}
      tone={tone}
      socialSignal={socialSignal}
      overflow={overflow}
      onAnswer={onAnswer}
      resultContent={resultContent}
    />
  )
}
