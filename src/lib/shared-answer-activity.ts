export type SharedAnswerActivity = {
  questionId: string
  questionText: string
  correctAnswer: string
  domain?: string | null
  topic?: string | null
  happenedAt: string
  friends: Array<{ userId: string; name: string; fromYourFeed: boolean }>
}

export type SharedAnswerEvidence = {
  userId: string
  questionId: string
  questionText: string
  correctAnswer: string
  domain?: string | null
  shortLabel?: string | null
  subjectEntity?: string | null
  answeredAt: Date
  answerId: string | null
}

export type SharedFeedEvidence = {
  id: string
  questionId: string | null
  recipientUserId: string
  sourceUserId: string
  sourceType: string
  sourceResult: string | null
  sourceEventAt: Date
}

// Prefer a question-specific label over the broader territory name. Existing
// subject metadata gives entity-focused questions a natural headline without
// guessing a topic from the question text or changing the stored domain.
export function sharedAnswerTopic(answer: Pick<SharedAnswerEvidence, 'shortLabel' | 'subjectEntity' | 'domain'>): string | null {
  const label = answer.shortLabel?.trim()
  if (label) return label
  const subject = answer.subjectEntity?.trim()
  if (subject) return /\bknowledge$/i.test(subject) ? subject : subject + ' knowledge'
  return answer.domain?.trim() || null
}

// A feed answer records its exact feed id. Milestone answers don't retain the
// selected friend; conservatively match the eligible bundle sources at that time.
function feedSources(
  answer: SharedAnswerEvidence,
  feed: SharedFeedEvidence[],
): Set<string> {
  if (!answer.answerId?.startsWith('feed:')) return new Set()
  return new Set(feed.filter((item) => {
    if (
      item.recipientUserId !== answer.userId ||
      item.questionId !== answer.questionId ||
      item.sourceEventAt > answer.answeredAt
    ) return false
    if (answer.answerId === `feed:${item.id}:${answer.questionId}:${answer.userId}` ||
        answer.answerId === `feed:${item.id}:recheck:${answer.questionId}:${answer.userId}` ||
        answer.answerId === `feed:${item.id}:${answer.userId}`) return true
    return (answer.answerId === `feed:milestone:${answer.questionId}:${answer.questionId}:${answer.userId}` ||
      answer.answerId === `feed:milestone:${answer.questionId}:${answer.userId}`) &&
      item.sourceType === 'friend_answered' && item.sourceResult === 'correct'
  }).map((item) => item.sourceUserId))
}

/** New overlap only: answering a friend's existing bundle is already visible
 * above. Independent answers and friends later playing our questions remain. */
export function deriveSharedAnswerActivity(
  viewerId: string,
  friends: Array<{ userId: string; name: string }>,
  answers: SharedAnswerEvidence[],
  feed: SharedFeedEvidence[],
  since: Date,
): SharedAnswerActivity[] {
  const earliest = new Map<string, SharedAnswerEvidence>()
  for (const answer of answers) {
    const key = `${answer.userId}\0${answer.questionId}`
    const previous = earliest.get(key)
    if (!previous || answer.answeredAt < previous.answeredAt ||
      (answer.answeredAt.getTime() === previous.answeredAt.getTime() &&
        (answer.answerId ?? '') < (previous.answerId ?? ''))) earliest.set(key, answer)
  }
  const grouped = new Map<string, SharedAnswerActivity>()
  for (const viewer of earliest.values()) {
    if (viewer.userId !== viewerId || !viewer.questionText.trim() || !viewer.correctAnswer.trim()) continue
    const viewerSources = feedSources(viewer, feed)
    for (const friend of friends) {
      const other = earliest.get(`${friend.userId}\0${viewer.questionId}`)
      if (!other || viewerSources.has(friend.userId)) continue
      const happenedAt = Math.max(viewer.answeredAt.getTime(), other.answeredAt.getTime())
      if (happenedAt < since.getTime()) continue
      let item = grouped.get(viewer.questionId)
      if (!item) {
        item = {
          questionId: viewer.questionId,
          questionText: viewer.questionText,
          correctAnswer: viewer.correctAnswer,
          domain: viewer.domain ?? null,
          topic: sharedAnswerTopic(viewer),
          happenedAt: new Date(happenedAt).toISOString(),
          friends: [],
        }
        grouped.set(viewer.questionId, item)
      }
      if (happenedAt > new Date(item.happenedAt).getTime()) item.happenedAt = new Date(happenedAt).toISOString()
      const friendSources = feedSources(other, feed)
      // Only credit our feed when its origin is unambiguous. A milestone may
      // have been offered by several friends; eligibility alone isn't attribution.
      item.friends.push({ ...friend, fromYourFeed: friendSources.size === 1 && friendSources.has(viewerId) })
    }
  }
  return [...grouped.values()].sort((a, b) =>
    b.happenedAt.localeCompare(a.happenedAt) || a.questionId.localeCompare(b.questionId),
  )
}
