import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', () => ({ db: {} }))

import { needsLiveActor } from '@/server/db/queries/activity'

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
