import type { ReactNode } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
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
  visibleCategory: string | null,
): string {
  if (viewerResult === 'correct') {
    if (friendCorrect === true) {
      return visibleCategory
        ? `You both know some ${visibleCategory}.`
        : 'You both got this one.'
    }
    if (friendCorrect === false) return `You knew this · ${friendName} didn’t`
    return `You answered · ${friendName} answered`
  }
  if (friendCorrect === true) return `${friendName} knew this · you missed it`
  if (friendCorrect === false) return 'Neither of you got this one'
  return `You missed this · ${friendName} answered`
}

function viewerAnsweredHeaderVerb(
  friendCorrect: boolean | null | undefined,
): string {
  if (friendCorrect === true) return 'got'
  if (friendCorrect === false) return 'missed'
  return 'answered'
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
  const visibleCategory = visibleFeedCategory(item.category)
  const footer = viewerResult ? (
    <p
      className="text-right text-[12px] italic leading-tight"
      style={{
        fontFamily: 'var(--font-literata)',
        color: 'var(--ink)',
        opacity: 0.7,
      }}
    >
      {viewerAnsweredFooterText(
        viewerResult,
        item.friendName,
        item.friendCorrect,
        visibleCategory,
      )}
    </p>
  ) : undefined

  const headerContent = viewerAnswered ? (
    <p className="text-[16px] leading-tight text-[var(--ink)]">
      {merged.authorHref ? (
        <Link
          href={merged.authorHref}
          className="underline underline-offset-2"
          style={{ textDecorationColor: 'rgb(0 0 0 / 0.35)' }}
        >
          {item.friendName}
        </Link>
      ) : (
        <span>{item.friendName}</span>
      )}
      {` ${viewerAnsweredHeaderVerb(item.friendCorrect)} your${
        visibleCategory ? ` ${visibleCategory}` : ''
      } question`}
    </p>
  ) : undefined

  return (
    <FeedCard
      item={merged}
      overflow={overflow}
      onAnswer={viewerAnswered ? undefined : onAnswer}
      footer={footer}
      headerContent={headerContent}
      dimQuestion={viewerAnswered}
    />
  )
}
