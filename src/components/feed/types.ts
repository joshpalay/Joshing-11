import type { ReactNode } from 'react'

export type FeedCardTone = 'cream' | 'white' | 'green' | 'amber' | 'gray' | 'muted'

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
  avatarName?: string | null
  avatarUserId?: string | null
}

export type DirectSentFeedItem = FeedCardBaseItem & {
  type: 'direct_sent'
  senderName: string
  senderHref?: string | null
}

export type FriendAnsweredParticipant = {
  userId: string
  displayName: string
  href?: string | null
}

export type FriendAnsweredFeedItem = FeedCardBaseItem & {
  type: 'friend_answered'
  friendName: string
  friendHref?: string | null
  friendCorrect?: boolean | null
  answerSummary?: ReactNode
  // Friends who got this question right, in order of recency.
  correctFriends?: FriendAnsweredParticipant[]
  // Viewer's own status on the underlying question, regardless of feed-item state.
  viewerResult?: 'correct' | 'incorrect' | null
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

export type AnsweredByYouMasteryDelta = {
  previousTier: string
  newTier: string
  tierChanged: boolean
}

export type AnsweredByYouFeedItem = FeedCardBaseItem & {
  type: 'answered_by_you'
  resultLabel?: string | null
  answerSummary?: ReactNode
  correctAnswer?: string | null
  submittedAnswer?: string | null
  isCorrect?: boolean | null
  awardedPoints?: number | null
  explanation?: string | null
  quip?: string | null
  unverifiedAnswer?: boolean
  broadCategory?: string | null
  masteryDelta?: AnsweredByYouMasteryDelta | null
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
  // When true, the question text is rendered dimmed so the social signal
  // becomes the visual focus. Used when the viewer has already answered.
  dimQuestion?: boolean
}
