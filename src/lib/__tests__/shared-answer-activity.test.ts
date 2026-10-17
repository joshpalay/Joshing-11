import { describe, expect, it } from 'vitest'
import { deriveSharedAnswerActivity, type SharedAnswerEvidence, type SharedFeedEvidence } from '@/lib/shared-answer-activity'

const since = new Date('2026-10-09T00:00:00Z')
const friends = [{ userId: 'chiann', name: 'Chiann' }]
function answer(userId: string, day = 12, answerId = `daily:queue:0:q:${userId}`, questionId = 'q'): SharedAnswerEvidence {
  return { userId, questionId, answerId, answeredAt: new Date(`2026-10-${day}T12:00:00Z`), questionText: `Question ${questionId}`, correctAnswer: 'Bach' }
}
function feed(recipientUserId: string, sourceUserId: string): SharedFeedEvidence {
  return { id: 'feed-id', questionId: 'q', recipientUserId, sourceUserId, sourceType: 'friend_answered', sourceResult: 'correct', sourceEventAt: new Date('2026-10-10T12:00:00Z') }
}
function derive(answers: SharedAnswerEvidence[], items: SharedFeedEvidence[] = []) {
  return deriveSharedAnswerActivity('me', friends, answers, items, since)
}

describe('Recent Activity: newly discovered shared answers', () => {
  it('shows one independent match immediately, including when the viewer answered second', () => {
    expect(derive([answer('me', 13), answer('chiann', 12)])[0]).toMatchObject({
      questionId: 'q', friends: [{ userId: 'chiann', fromYourFeed: false }], happenedAt: '2026-10-13T12:00:00.000Z',
    })
  })
  it.each(['feed:feed-id:q:me', 'feed:feed-id:recheck:q:me', 'feed:milestone:q:q:me', 'feed:feed-id:me', 'feed:milestone:q:me'])(
    'excludes a viewer playing Chiann’s existing question (%s)', (answerId) => {
      expect(derive([answer('me', 12, answerId), answer('chiann', 10)], [feed('me', 'chiann')])).toEqual([])
    },
  )
  it('keeps Chiann playing a question from the viewer’s feed', () => {
    expect(derive([answer('me', 10), answer('chiann', 12, 'feed:milestone:q:q:chiann')], [feed('chiann', 'me')])[0].friends)
      .toEqual([{ userId: 'chiann', name: 'Chiann', fromYourFeed: true }])
  })
  it('does not credit our feed when multiple milestone sources were eligible', () => {
    const items = derive([answer('me', 10), answer('chiann', 12, 'feed:milestone:q:q:chiann')], [
      feed('chiann', 'me'), { ...feed('chiann', 'another-person'), id: 'other-feed-id' },
    ])
    expect(items[0].friends[0].fromYourFeed).toBe(false)
  })
  it('does not infer feed origin from a feed row alone or one created after the answer', () => {
    expect(derive([answer('me', 12), answer('chiann', 10)], [feed('me', 'chiann')])).toHaveLength(1)
    expect(derive([answer('me', 12, 'feed:feed-id:q:me'), answer('chiann', 10)], [
      { ...feed('me', 'chiann'), sourceEventAt: new Date('2026-10-14T12:00:00Z') },
    ])).toHaveLength(1)
  })
  it('does not infer a milestone source from a wrong-answer feed row', () => {
    expect(derive([answer('me', 12, 'feed:milestone:q:q:me'), answer('chiann', 10)], [
      { ...feed('me', 'chiann'), sourceResult: 'incorrect' },
    ])).toHaveLength(1)
  })
  it('keeps old viewer answers meeting new friend answers, and excludes old overlaps', () => {
    const old = { ...answer('me'), answeredAt: new Date('2026-06-01T12:00:00Z') }
    expect(derive([old, answer('chiann')])).toHaveLength(1)
    expect(derive([old, { ...answer('chiann'), answeredAt: old.answeredAt }])).toEqual([])
  })
  it('uses earliest correct answers so repeats do not revive an old or previously played overlap', () => {
    expect(derive([answer('me', 12), answer('me', 11, 'feed:feed-id:q:me'), answer('chiann', 10)], [feed('me', 'chiann')])).toEqual([])
    const old = new Date('2026-06-01T12:00:00Z')
    expect(derive([{ ...answer('me'), answeredAt: old }, { ...answer('chiann'), answeredAt: old }, answer('chiann', 14)])).toEqual([])
  })
  it('groups multiple friends under one question and excludes non-friends and incomplete data', () => {
    const items = deriveSharedAnswerActivity('me', [...friends, { userId: 'david', name: 'David' }], [
      answer('me'), answer('chiann'), answer('david'), answer('stranger'),
      { ...answer('me', 12, 'x', 'empty'), correctAnswer: '' }, answer('chiann', 12, 'x', 'empty'),
    ], [], since)
    expect(items).toHaveLength(1)
    expect(items[0].friends.map((f) => f.userId)).toEqual(['chiann', 'david'])
    expect(derive([answer('me')])).toEqual([])
  })
})
