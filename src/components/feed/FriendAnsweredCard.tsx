import type { ReactNode } from 'react'
import { Fragment } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import type { FriendAnsweredFeedItem, FriendAnsweredParticipant } from './types'

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

function joinNames(nodes: ReactNode[], conjunction = 'and'): ReactNode {
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]
  if (nodes.length === 2) return <>{nodes[0]} {conjunction} {nodes[1]}</>
  return (
    <>
      {nodes.slice(0, -1).map((n, i) => (
        <Fragment key={i}>{n}, </Fragment>
      ))}
      {conjunction} {nodes[nodes.length - 1]}
    </>
  )
}

function friendNameNodes(friends: FriendAnsweredParticipant[]): ReactNode[] {
  return friends.map((friend, i) => (
    <PersonName key={friend.userId ?? i} href={friend.href} name={friend.displayName} />
  ))
}

export function FriendAnsweredCard({
  item,
  overflow,
  onAnswer,
  resultContent,
}: FriendAnsweredCardProps) {
  const correctFriends = item.correctFriends ?? []
  const viewerCorrect = item.viewerResult === 'correct'
  const viewerAnswered = item.viewerResult !== null && item.viewerResult !== undefined

  // Single-friend fallback when no aggregated list provided.
  const fallbackFriends: FriendAnsweredParticipant[] =
    correctFriends.length === 0 && item.friendCorrect
      ? [{ userId: '', displayName: item.friendName, href: item.friendHref ?? null }]
      : correctFriends

  let socialSignal: ReactNode
  let tone: 'green' | 'white' | 'muted'

  if (viewerAnswered && fallbackFriends.length > 0) {
    // Viewer already answered the question. Muted treatment, question dimmed,
    // social update foregrounded.
    tone = 'muted'
    const friendNodes = friendNameNodes(fallbackFriends)
    if (viewerCorrect) {
      const all = joinNames([<>You</>, ...friendNodes])
      socialSignal = <>{all} got this right.</>
    } else {
      // Viewer got it wrong — don't call attention to that. Just show friends.
      socialSignal = <>{joinNames(friendNodes)} got this right.</>
    }
  } else if (fallbackFriends.length > 0) {
    // Viewer hasn't answered. Active card prompting answer.
    tone = 'green'
    const friendNodes = friendNameNodes(fallbackFriends)
    socialSignal = <>{joinNames(friendNodes)} got this right.</>
  } else {
    // Fallback (no friend list, friend didn't get it right) — keep prior behavior.
    tone = 'white'
    socialSignal = item.answerSummary ?? (
      <>
        <PersonName href={item.friendHref} name={item.friendName} /> answered this.
      </>
    )
  }

  return (
    <FeedCard
      item={item}
      tone={tone}
      socialSignal={socialSignal}
      overflow={overflow}
      onAnswer={viewerAnswered ? undefined : onAnswer}
      resultContent={resultContent}
      dimQuestion={viewerAnswered}
    />
  )
}
