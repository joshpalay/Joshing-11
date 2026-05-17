import type { ReactNode } from 'react'
import { Fragment } from 'react'
import Link from 'next/link'

import { FeedCard } from './FeedCard'
import { visibleFeedCategory } from './category'
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

  const category = visibleFeedCategory(item.category)
  const categoryClause = category ? <> about {category}</> : null

  let socialSignal: ReactNode
  let tone: 'green' | 'white' | 'muted'

  if (viewerAnswered && fallbackFriends.length > 0) {
    tone = 'muted'
    const friendNodes = friendNameNodes(fallbackFriends)
    if (viewerCorrect) {
      const all = joinNames([<>You</>, ...friendNodes])
      socialSignal = <>{all} got this right{categoryClause}.</>
    } else {
      socialSignal = <>{joinNames(friendNodes)} got this right{categoryClause}.</>
    }
  } else if (fallbackFriends.length > 0) {
    tone = 'green'
    const friendNodes = friendNameNodes(fallbackFriends)
    socialSignal = <>{joinNames(friendNodes)} got this right{categoryClause}.</>
  } else {
    tone = 'white'
    socialSignal = (
      <>
        <PersonName href={item.friendHref} name={item.friendName} /> answered this{categoryClause}.
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
