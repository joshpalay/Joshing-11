import { beforeEach, describe, expect, it, vi } from 'vitest'

// Characterization tests for the milestone in-place answer route (B-ANSWER-
// PIPELINE-01 Phase 1): full-credit path parity with the feed answer route,
// plus this route's distinctive behavior — a wrong answer writes a synthetic
// milestone_missed feed item so feed catch-up can offer a second swing.

const {
  awardAuthorCreditMock,
  createFeedItemsForFriendsFromAnswerMock,
  getBasePointsMock,
  getSeededPlayQuestionsMock,
  getSessionMock,
  gradeAnswerMock,
  insertedRows,
  promoteDeclaredToDemonstratedMock,
  readPriorAnswersForQuestionMock,
  writeMasteryEventMock,
  dbMock,
  selectCallChain,
} = vi.hoisted(() => {
  const selectCallChain: Array<() => Promise<unknown[]>> = []
  const insertedRows: Array<Record<string, unknown>> = []
  function makeChainable() {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.limit = () => {
      const handler = selectCallChain.shift() ?? (async () => [])
      return handler()
    }
    return chain
  }
  return {
    awardAuthorCreditMock: vi.fn(async () => undefined),
    createFeedItemsForFriendsFromAnswerMock: vi.fn(async () => undefined),
    getBasePointsMock: vi.fn((_difficulty: unknown, state: string) => {
      if (state === 'first_correct') return 100
      if (state === 'first_correct_after_wrong') return 25
      return 0
    }),
    getSeededPlayQuestionsMock: vi.fn(async () => [{ id: 'canonical-q-1' }]),
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
    insertedRows,
    promoteDeclaredToDemonstratedMock: vi.fn(),
    readPriorAnswersForQuestionMock: vi.fn(async () => []),
    writeMasteryEventMock: vi.fn(async () => ({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: false,
    })),
    dbMock: {
      select: vi.fn(() => makeChainable()),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          insertedRows.push(row)
          return { onConflictDoNothing: vi.fn(async () => undefined) }
        }),
      })),
    },
    selectCallChain,
  }
})

const QUESTION = {
  id: 'canonical-q-1',
  questionText: 'q?',
  answerText: 'A',
  acceptedAlternatives: [],
  questionType: 'factual',
  creatorId: 'author-1',
  source: 'authored',
  canonicalSubcategory: 'history',
  broadCategory: 'humanities',
  category: 'humanities',
  calibratedDifficulty: 'specialist',
  llmDifficulty: 'specialist',
  askedCount: 3,
  correctCount: 2,
  insideJoke: null,
  creatorNote: null,
  explainerFull: 'e',
  explainerBrief: null,
  factualExplanation: null,
}

vi.mock('@/server/grading', () => ({ gradeAnswer: gradeAnswerMock }))
vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db/queries/lately', () => ({
  getSeededPlayQuestions: getSeededPlayQuestionsMock,
}))
vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: { recipientUserId: 'f.recipient', sourceAnswerId: 'f.sourceAnswerId' },
  playerMastery: { userId: 'p.userId', canonicalSubcategory: 'p.cs', tier: 'p.tier' },
  questions: {
    id: 'q.id',
    creatorId: 'q.creatorId',
    askedCount: 'q.askedCount',
    correctCount: 'q.correctCount',
  },
  users: { id: 'u.id', displayName: 'u.display' },
}))
vi.mock('@/server/mastery/scoring', () => ({ getBasePoints: getBasePointsMock }))
vi.mock('@/server/mastery/write-mastery-event', () => ({ writeMasteryEvent: writeMasteryEventMock }))
vi.mock('@/server/mastery/author-credit', () => ({ awardAuthorCredit: awardAuthorCreditMock }))
vi.mock('@/server/feed/create-feed-items-for-answer', () => ({
  createFeedItemsForFriendsFromAnswer: createFeedItemsForFriendsFromAnswerMock,
}))
vi.mock('@/server/knowledge/open-domain', () => ({
  promoteDeclaredToDemonstrated: promoteDeclaredToDemonstratedMock,
}))
vi.mock('@/server/questions/inside-joke', () => ({
  selectInsideJokeForViewer: vi.fn(async () => null),
}))
vi.mock('@/server/answer-state', async () => {
  const actual = await vi.importActual<typeof import('@/server/answer-state')>('@/server/answer-state')
  return actual
})
// next/server's after() requires an active request scope at runtime; run the
// callback synchronously in tests so the fan-out side effect still fires.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown) => {
      void fn()
    },
  }
})
vi.mock('@/server/answer-history', () => ({
  readPriorAnswersForQuestion: readPriorAnswersForQuestionMock,
}))

import { POST } from '@/app/api/lately/milestone/answer/route'

function setupDbChain(question: Record<string, unknown> = QUESTION) {
  selectCallChain.length = 0
  selectCallChain.push(async () => [question])
  selectCallChain.push(async () => []) // playerMastery: none
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/lately/milestone/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const VALID_BODY = { questionId: 'canonical-q-1', submitted_answer: 'A' }

describe('POST /api/lately/milestone/answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    getSeededPlayQuestionsMock.mockResolvedValue([{ id: 'canonical-q-1' }])
    readPriorAnswersForQuestionMock.mockResolvedValue([])
  })

  it('first-time correct: full base points, mastery write, fan-out', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'correct', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isCorrect).toBe(true)
    expect(body.pointsAwarded).toBe(100)
    expect(body.answerState).toBe('first_correct')

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct',
        pointsAwarded: 100,
        sourceId: 'milestone:canonical-q-1',
      }),
    )
    expect(createFeedItemsForFriendsFromAnswerMock).toHaveBeenCalledWith(
      'user-1',
      'canonical-q-1',
      'correct',
      'milestone:canonical-q-1:user-1',
    )
    expect(insertedRows).toHaveLength(0)
  })

  it('repeat correct scores zero (no-double-credit guarantee)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValue([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'correct', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    const body = await res.json()
    expect(body.answerState).toBe('repeat_correct')
    expect(body.pointsAwarded).toBe(0)
    expect(awardAuthorCreditMock).not.toHaveBeenCalled()
  })

  it('wrong answer: zero points and a synthetic milestone_missed catch-up row', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'wrong', consolation: 'close' })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    const body = await res.json()
    expect(body.isCorrect).toBe(false)
    expect(body.pointsAwarded).toBe(0)
    expect(createFeedItemsForFriendsFromAnswerMock).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      sourceType: 'milestone_missed',
      answerResult: 'incorrect',
      sourceAnswerId: 'milestone-miss:canonical-q-1',
      state: 'answered',
    })
  })

  it('grader outage: 503 hold, nothing persisted', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'unscored', reason: 'llm_error' })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(503)
    expect(writeMasteryEventMock).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(0)
  })

  it('authors cannot answer their own milestone question (403)', async () => {
    setupDbChain({ ...QUESTION, creatorId: 'user-1' })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(403)
    expect(gradeAnswerMock).not.toHaveBeenCalled()
  })

  it('404s when the question is not in the viewer milestones (authorization by construction)', async () => {
    getSeededPlayQuestionsMock.mockResolvedValue([])

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(404)
    expect(gradeAnswerMock).not.toHaveBeenCalled()
  })
})
