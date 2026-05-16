import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
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

export function DirectSentCard({
  item,
  overflow,
  onAnswer,
  resultContent,
}: DirectSentCardProps) {
  const socialSignal: ReactNode = (
    <>
      <PersonName href={item.senderHref} name={item.senderName} /> thought
      you&apos;d like this one.
    </>
  )

  return (
    <FeedCard
      item={item}
      tone="cream"
      socialSignal={socialSignal}
      overflow={overflow}
      onAnswer={onAnswer}
      resultContent={resultContent}
    />
  )
}
