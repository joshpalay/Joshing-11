import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
import type { DirectSentFeedItem } from './types'

type DirectSentCardProps = {
  item: DirectSentFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
}

export function DirectSentCard({ item, overflow, onAnswer }: DirectSentCardProps) {
  const merged: DirectSentFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.senderName,
    authorHref: item.authorHref ?? item.senderHref ?? null,
  }
  const visibleCategory = visibleFeedCategory(item.category)
  const senderHref = item.senderHref ?? merged.authorHref ?? null

  // Restores the distinguishing "sent to you" treatment that the
  // author+category header redesign (67f104d) flattened away: a small
  // eyebrow plus the original "{sender} thought you'd like this" signal.
  const headerContent = (
    <>
      <p
        className="text-[11px] uppercase leading-none tracking-[0.08em]"
        style={{ color: 'var(--ink)', opacity: 0.7 }}
      >
        Sent to you
      </p>
      <p className="mt-1 text-[14px] leading-snug text-[var(--ink)]">
        {senderHref ? (
          <Link
            href={senderHref}
            className="font-semibold underline underline-offset-2"
            style={{ textDecorationColor: 'rgb(0 0 0 / 0.35)' }}
          >
            {item.senderName}
          </Link>
        ) : (
          <span className="font-semibold">{item.senderName}</span>
        )}{' '}
        thought you&rsquo;d like this
        {visibleCategory ? <> about {visibleCategory}</> : null}.
      </p>
    </>
  )

  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={onAnswer}
      headerContent={headerContent}
    />
  )
}
