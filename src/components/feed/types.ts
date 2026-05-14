import type { ReactNode } from 'react'

export type FeedCardTone = 'cream' | 'white' | 'green' | 'amber' | 'gray'

export type FeedCardActionState =
  | 'unanswered'
  | 'answering'
  | 'answered'
  | 'seen'

export type FeedCardBaseItem = {
  id: string
  metadata: string
  question: string
  category?: string | null
  personalMessage?: string | null
}

export type DirectSentFeedItem = FeedCardBaseItem & {
  type: 'direct_sent'
  senderName: string
}

export type FriendAnsweredFeedItem = FeedCardBaseItem & {
  type: 'friend_answered'
  friendName: string
  friendCorrect?: boolean | null
  answerSummary?: string | null
}

export type FriendAddedFeedItem = FeedCardBaseItem & {
  type: 'friend_added'
  friendName: string
}

export type FriendLikedFeedItem = FeedCardBaseItem & {
  type: 'friend_liked'
  friendName: string
}

export type AnsweredByYouFeedItem = FeedCardBaseItem & {
  type: 'answered_by_you'
  resultLabel?: string | null
  answerSummary?: string | null
}

export type TypedFeedItem =
  | DirectSentFeedItem
  | FriendAnsweredFeedItem
  | FriendAddedFeedItem
  | FriendLikedFeedItem
  | AnsweredByYouFeedItem

export type FeedCardShellProps = {
  item: FeedCardBaseItem
  tone: FeedCardTone
  eyebrow?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}
