import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem } from './types'

type FriendAnsweredCardProps = {
  item: FriendAnsweredFeedItem
  overflow?: ReactNode
  onAnswer?: () => void
}

function viewerAnsweredFooterText(
  viewerResult: 'correct' | 'incorrect',
  friendName: string,
  friendCorrect: boolean | null | undefined,
): string {
  if (viewerResult === 'correct') {
    if (friendCorrect === true) return 'You both had it'
    if (friendCorrect === false) return `You knew this · ${friendName} didn’t`
    return `You answered · ${friendName} answered`
  }
  if (friendCorrect === true) return `${friendName} knew this · you missed it`
  if (friendCorrect === false) return 'Neither of you got this one'
  return `You missed this · ${friendName} answered`
}

export function FriendAnsweredCard({
  item,
  overflow,
  onAnswer,
}: FriendAnsweredCardProps) {
  const viewerResult = item.viewerResult ?? null
  const viewerAnswered = viewerResult !== null
  const merged: FriendAnsweredFeedItem = {
    ...item,
    avatarName: item.avatarName ?? item.friendName,
    authorHref: item.authorHref ?? item.friendHref ?? null,
  }
  const footer = viewerResult ? (
    <p
      className="text-right text-[12px] italic leading-tight"
      style={{
        fontFamily: 'var(--font-literata)',
        color: 'var(--ink)',
        opacity: 0.7,
      }}
    >
      {viewerAnsweredFooterText(viewerResult, item.friendName, item.friendCorrect)}
    </p>
  ) : undefined
  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={viewerAnswered ? undefined : onAnswer}
      footer={footer}
    />
  )
}
