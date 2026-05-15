import type { ReactNode } from 'react'

export type FeedCardTone = 'cream' | 'white' | 'green' | 'amber' | 'gray'

export type FeedCardActionState =
  | 'unanswered'
  | 'answering'
  | 'answered'
  | 'seen'

export type FeedCardBaseItem = {
  id: string
  metadata: ReactNode
  question: string
  category?: string | null
  personalMessage?: string | null
  isInBank?: boolean
}

export type DirectSentFeedItem = FeedCardBaseItem & {
  type: 'direct_sent'
  senderName: string
  senderHref?: string | null
}

export type FriendAnsweredFeedItem = FeedCardBaseItem & {
  type: 'friend_answered'
  friendName: string
  friendHref?: string | null
  friendCorrect?: boolean | null
  answerSummary?: string | null
}

export type FriendAddedFeedItem = FeedCardBaseItem & {
  type: 'friend_added'
  friendName: string
  friendHref?: string | null
}

export type FriendLikedFeedItem = FeedCardBaseItem & {
  type: 'friend_liked'
  friendName: string
  friendHref?: string | null
  endorsementCount?: number | null
  additionalEndorsers?: Array<{ userId: string; displayName: string }> | null
}

export type AnsweredByYouFeedItem = FeedCardBaseItem & {
  type: 'answered_by_you'
  resultLabel?: string | null
  answerSummary?: string | null
  correctAnswer?: string | null
  submittedAnswer?: string | null
  isCorrect?: boolean | null
  awardedPoints?: number | null
  explanation?: string | null
  quip?: string | null
  unverifiedAnswer?: boolean
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
  socialSignal?: ReactNode
  overflow?: ReactNode
  onAnswer?: () => void
  resultContent?: ReactNode
  className?: string
}
