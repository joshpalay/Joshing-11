import { beforeEach, describe, expect, it, vi } from 'vitest'

// Characterization tests for the public-profile answer route (B-ANSWER-
// PIPELINE-01 Phase 1): pin grading flow, answer_state/points derivation,
// mastery write, propagation gating, and the access guards before/while the
// route is migrated onto the shared answer pipeline.

const {
  awardAuthorCreditMock,
  createFeedItemsForFriendsFromAnswerMock,
  getBasePointsMock,
  getSessionMock,
  gradeAnswerMock,
  promoteDeclaredToDemonstratedMock,
  readPriorAnswersForQuestionMock,
  writeMasteryEventMock,
  dbMock,
  selectCallChain,
} = vi.hoisted(() => {
  // Drizzle chain mock — sequence: question lookup, playerMastery lookup.
  const selectCallChain: Array<() => Promise<unknown[]>> = []
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
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
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
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(async () => undefined),
            })),
          })),
        }
        await fn(tx)
      }),
    },
    selectCallChain,
  }
})

const QUESTION = {
  id: 'canonical-q-1',
  deletedAt: null,
  visibility: 'public',
  questionText: 'q?',
  answerText: 'A',
  acceptedAlternatives: [],
  questionType: 'factual',
  creatorId: 'author-1',
  canonicalSubcategory: 'history',
  broadCategory: 'humanities',
  category: 'humanities',
  calibratedDifficulty: 'specialist',
  llmDifficulty: 'specialist',
  askedCount: 3,
  correctCount: 2,
  explainerFull: 'e',
  explainerBrief: null,
  factualExplanation: null,
}

vi.mock('@/server/grading', () => ({
  gradeAnswer: gradeAnswerMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  playerMastery: { userId: 'p.userId', canonicalSubcategory: 'p.cs', tier: 'p.tier' },
  questions: {
    id: 'q.id',
    deletedAt: 'q.deletedAt',
    creatorId: 'q.creatorId',
    askedCount: 'q.askedCount',
    correctCount: 'q.correctCount',
  },
}))

vi.mock('@/server/mastery/scoring', () => ({
  getBasePoints: getBasePointsMock,
}))

vi.mock('@/server/mastery/write-mastery-event', () => ({
  writeMasteryEvent: writeMasteryEventMock,
}))

vi.mock('@/server/mastery/author-credit', () => ({
  awardAuthorCredit: awardAuthorCreditMock,
}))

vi.mock('@/server/feed/create-feed-items-for-answer', () => ({
  createFeedItemsForFriendsFromAnswer: createFeedItemsForFriendsFromAnswerMock,
}))

vi.mock('@/server/knowledge/open-domain', () => ({
  promoteDeclaredToDemonstrated: promoteDeclaredToDemonstratedMock,
}))

vi.mock('@/server/answer-state', async () => {
  const actual = await vi.importActual<typeof import('@/server/answer-state')>(
    '@/server/answer-state',
  )
  return actual
})

// next/server's after() requires an active request scope at runtime and throws
// otherwise. In tests, run the callback synchronously so its side effect (the
// feed fan-out) still fires while keeping NextResponse intact.
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

import { POST } from '@/app/api/questions/[id]/answer/route'

function setupDbChain(question: Record<string, unknown> = QUESTION) {
  selectCallChain.length = 0
  selectCallChain.push(async () => [question])
  selectCallChain.push(async () => []) // playerMastery: none
}

function makeContext(id = 'canonical-q-1') {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/questions/canonical-q-1/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/questions/[id]/answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readPriorAnswersForQuestionMock.mockResolvedValue([])
  })

  it('first-time correct: full base points, mastery write, credit + fan-out', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'correct', consolation: null })

    const res = await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isCorrect).toBe(true)
    expect(body.pointsAwarded).toBe(100)
    expect(body.answerState).toBe('first_correct')

    expect(gradeAnswerMock).toHaveBeenCalledWith('A', 'A', [], 'q?', 'factual')
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct',
        pointsAwarded: 100,
        sourceType: 'feed',
        sourceId: 'profile:canonical-q-1:user-1',
        eventQuestionId: 'canonical-q-1',
      }),
    )
    expect(awardAuthorCreditMock).toHaveBeenCalled()
    expect(promoteDeclaredToDemonstratedMock).toHaveBeenCalled()
    expect(createFeedItemsForFriendsFromAnswerMock).toHaveBeenCalledWith(
      'user-1',
      'canonical-q-1',
      'correct',
      'profile:canonical-q-1:user-1',
    )
  })

  it('recovery after a prior wrong: recovery-weighted points', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValue([{ result: 'wrong' }])
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'correct', consolation: null })

    const res = await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext() as never)
    const body = await res.json()
    expect(body.answerState).toBe('first_correct_after_wrong')
    expect(body.pointsAwarded).toBe(25)
  })

  it('wrong answer: zero points, no credit, no fan-out', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'scored', result: 'wrong', consolation: 'close' })

    const res = await POST(jsonRequest({ submitted_answer: 'B' }) as never, makeContext() as never)
    const body = await res.json()
    expect(body.isCorrect).toBe(false)
    expect(body.pointsAwarded).toBe(0)
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ answerState: 'incorrect', pointsAwarded: 0 }),
    )
    expect(awardAuthorCreditMock).not.toHaveBeenCalled()
    expect(createFeedItemsForFriendsFromAnswerMock).not.toHaveBeenCalled()
  })

  it('grader outage: 503 hold, nothing persisted', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ status: 'unscored', reason: 'llm_error' })

    const res = await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext() as never)
    expect(res.status).toBe(503)
    expect(writeMasteryEventMock).not.toHaveBeenCalled()
  })

  it('authors cannot answer their own question (403)', async () => {
    setupDbChain({ ...QUESTION, creatorId: 'user-1' })

    const res = await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext() as never)
    expect(res.status).toBe(403)
    expect(gradeAnswerMock).not.toHaveBeenCalled()
  })

  it('non-public questions are forbidden (403) — including blocked', async () => {
    setupDbChain({ ...QUESTION, visibility: 'blocked' })

    const res = await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext() as never)
    expect(res.status).toBe(403)
    expect(gradeAnswerMock).not.toHaveBeenCalled()
  })
})
