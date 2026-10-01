import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', () => ({ db: {} }))

import { dropRepeatedRelationshipRows, needsCurrentFriend, needsLiveActor } from '@/server/db/queries/activity'

describe('needsLiveActor — no anonymous "Someone" activity (QA 2026-09-25 follow-up)', () => {
  it('drops rows about a person once that person is gone', () => {
    for (const type of [
      'follow_mutual',
      'invited_friend_played_first_five',
      'friend_answered_your_question',
      'niche_match_answered_your_question',
    ]) {
      expect(needsLiveActor(type)).toBe(true)
    }
  })

  it('keeps system and viewer-own rows that never name anyone', () => {
    for (const type of ['ceremony_ready', 'authored_question_shared', 'friend_invitation_reminder']) {
      expect(needsLiveActor(type)).toBe(false)
    }
  })
})

describe('friend-only feed rows (QA 2026-10-01, S1)', () => {
  it("gates a friend's own-activity rows on a current friendship, like the relationship rows", () => {
    for (const type of ['follow', 'follow_approved', 'follow_mutual', 'invited_friend_played_first_five']) {
      expect(needsCurrentFriend(type)).toBe(true)
    }
    for (const type of ['friend_answered_your_question', 'ceremony_ready']) {
      expect(needsCurrentFriend(type)).toBe(false)
    }
  })

  it('keeps only the newest "now friends" row per person', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h))
    const rows = [
      { id: 'played', type: 'invited_friend_played_first_five', actorUserId: 'quad', createdAt: at(10) },
      { id: 'tres-3', type: 'follow_mutual', actorUserId: 'tres', createdAt: at(9) },
      { id: 'tres-2', type: 'follow_mutual', actorUserId: 'tres', createdAt: at(8) },
      { id: 'quad-1', type: 'follow_mutual', actorUserId: 'quad', createdAt: at(7) },
      { id: 'tres-1', type: 'follow_mutual', actorUserId: 'tres', createdAt: at(6) },
      { id: 'mine', type: 'ceremony_ready', actorUserId: null, createdAt: at(5) },
    ]
    expect(dropRepeatedRelationshipRows(rows).map((row) => row.id)).toEqual(['played', 'tres-3', 'quad-1', 'mine'])
  })
})
