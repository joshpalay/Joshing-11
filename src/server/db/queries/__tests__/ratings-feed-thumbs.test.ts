import { beforeEach, describe, expect, it, vi } from 'vitest'

// recordFeedThumbsUp consolidates the feed-side surfacePriorityScore write
// into the query layer (2026-06-12 structural audit, STRUCT-06) and makes it
// idempotent: the QuestionFeedback unique (user_id, question_id) key dedupes
// the signal, and the score bumps ONLY when the signal is newly recorded —
// repeat taps used to inflate the score on every POST.

const { state, dbMock } = vi.hoisted(() => {
  const state = {
    insertReturns: [] as Array<Record<string, unknown>>,
    updates: 0,
  }
  const dbMock = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => state.insertReturns),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          state.updates += 1
        }),
      })),
    })),
  }
  return { state, dbMock }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  count: vi.fn(() => ({ op: 'count' })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  sql: vi.fn(() => ({ op: 'sql' })),
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: { id: 'f.id' },
  questionFeedback: { id: 'qf.id' },
  questionRatings: { userId: 'qr.userId', questionId: 'qr.questionId', rating: 'qr.rating' },
  questions: { id: 'q.id', surfacePriorityScore: 'q.sps' },
}))

import { recordFeedThumbsUp } from '@/server/db/queries/ratings'

describe('recordFeedThumbsUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.insertReturns = []
    state.updates = 0
  })

  it('bumps surfacePriorityScore when the signal is newly recorded', async () => {
    state.insertReturns = [{ id: 'fb-1' }]

    await recordFeedThumbsUp('user-1', 'question-1')

    expect(state.updates).toBe(1)
  })

  it('is a no-op on a repeat tap (signal already recorded)', async () => {
    state.insertReturns = [] // onConflictDoNothing hit the unique key

    await recordFeedThumbsUp('user-1', 'question-1')

    expect(state.updates).toBe(0)
  })
})
