import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createFeedItemsForFriendsFromAnswerMock,
  generateBreadcrumbMock,
  getSessionMock,
  gradeAnswerMock,
  persistGeneratedQuestionMock,
  promoteDeclaredToDemonstratedMock,
  readPriorAnswersForQuestionMock,
  selectQuipMock,
  suggestAnswerMock,
  updateDomainDifficultyOnAnswerMock,
  writeMasteryEventMock,
  dbState,
} = vi.hoisted(() => {
  const QUEUE = {
    id: 'queue-1',
    userId: 'user-1',
    slots: [
      {
        slot_index: 0,
        source: 'bot',
        generated_question_id: 'gen-q-1',
        domain: 'history',
        question_text: 'q?',
        answered: false,
      },
    ],
  }

  const QUESTION = {
    id: 'gen-q-1',
    userId: 'user-1',
    questionText: 'q?',
    answer: 'A',
    explainer: 'e',
    canonicalSubcategory: 'history',
    broadCategory: 'humanities',
    basePoints: 100,
  }

  const dbState = {
    queue: QUEUE,
    question: QUESTION,
    persistedQuestion: {
      creatorId: 'author-1',
      domain: 'history',
      broadCategory: 'humanities',
      category: 'humanities',
    },
  }

  return {
    createFeedItemsForFriendsFromAnswerMock: vi.fn(async () => undefined),
    generateBreadcrumbMock: vi.fn(async () => null),
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
    persistGeneratedQuestionMock: vi.fn(async () => ({
      questionId: 'canonical-q-1',
      alreadyExisted: false,
    })),
    promoteDeclaredToDemonstratedMock: vi.fn(),
    readPriorAnswersForQuestionMock: vi.fn(async () => []),
    selectQuipMock: vi.fn(() => 'quip'),
    suggestAnswerMock: vi.fn(),
    updateDomainDifficultyOnAnswerMock: vi.fn(async () => undefined),
    writeMasteryEventMock: vi.fn(async () => ({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
    })),
    dbState,
  }
})

// Drizzle chain mock: db.select().from().where().limit() — returns canned rows
// based on which "table" was selected. We dispatch on the order of select()
// calls within a single request: queue → question → persistedQuestion.
const selectCallChain: Array<() => Promise<unknown[]>> = []

const dbMock = {
  select: vi.fn(() => {
    const handler = selectCallChain.shift() ?? (async () => [])
    return {
      from: () => ({
        where: () => ({
          limit: handler,
        }),
      }),
    }
  }),
  update: vi.fn(() => ({
    set: () => ({
      where: vi.fn(async () => undefined),
    }),
  })),
}

vi.mock('@/server/grading', () => ({
  gradeAnswer: gradeAnswerMock,
  selectQuip: selectQuipMock,
}))

vi.mock('@/server/adaptive-difficulty', () => ({
  updateDomainDifficultyOnAnswer: updateDomainDifficultyOnAnswerMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  dailyQueues: { id: 'q.id', userId: 'q.userId' },
  generatedQuestions: { id: 'g.id', userId: 'g.userId', answer: 'g.answer' },
  questions: {
    id: 'q.id',
    creatorId: 'q.creatorId',
    canonicalSubcategory: 'q.cs',
    broadCategory: 'q.bc',
    category: 'q.c',
  },
}))

vi.mock('@/server/daily/generate-breadcrumb', () => ({
  generateBreadcrumb: generateBreadcrumbMock,
}))

vi.mock('@/server/mastery/write-mastery-event', () => ({
  writeMasteryEvent: writeMasteryEventMock,
}))

vi.mock('@/server/feed/create-feed-items-for-answer', () => ({
  createFeedItemsForFriendsFromAnswer: createFeedItemsForFriendsFromAnswerMock,
}))

vi.mock('@/server/knowledge/open-domain', () => ({
  promoteDeclaredToDemonstrated: promoteDeclaredToDemonstratedMock,
}))

vi.mock('@/server/questions/persist-generated-question', () => ({
  persistGeneratedQuestion: persistGeneratedQuestionMock,
}))

vi.mock('@/server/answers/canonical-answer', () => ({
  isGenericCanonicalAnswer: () => false,
  normalizeCanonicalAnswerLabel: (s: string) => s,
}))

vi.mock('@/lib/llm', () => ({
  suggestAnswer: suggestAnswerMock,
}))

vi.mock('@/server/answer-history', () => ({
  readPriorAnswersForQuestion: readPriorAnswersForQuestionMock,
}))

import { POST } from '@/app/api/daily/answer/route'

function setupDbChain() {
  // Reset and re-seed for one full POST: queue, question, persistedQuestion.
  selectCallChain.length = 0
  selectCallChain.push(async () => [dbState.queue])
  selectCallChain.push(async () => [dbState.question])
  selectCallChain.push(async () => [dbState.persistedQuestion])
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/daily/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  queue_id: 'queue-1',
  slot_index: 0,
  submitted_answer: 'A',
}

describe('POST /api/daily/answer mastery scoring (F2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readPriorAnswersForQuestionMock.mockResolvedValue([])
    persistGeneratedQuestionMock.mockResolvedValue({
      questionId: 'canonical-q-1',
      alreadyExisted: false,
    })
    writeMasteryEventMock.mockResolvedValue({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
    })
  })

  it('first-time correct: writes first_correct with full base points and canonical eventQuestionId', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)

    expect(persistGeneratedQuestionMock).toHaveBeenCalledWith('gen-q-1')
    expect(readPriorAnswersForQuestionMock).toHaveBeenCalledWith(
      'user-1',
      'canonical-q-1',
    )
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct',
        pointsAwarded: 100,
        eventQuestionId: 'canonical-q-1',
      }),
    )
  })

  it('first-time wrong: writes incorrect with zero points', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: 'try again' })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'incorrect',
        pointsAwarded: 0,
      }),
    )
  })

  it('prior wrong then correct: writes first_correct_after_wrong with 0.25x base points', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'wrong' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct_after_wrong',
        pointsAwarded: 25, // 100 * 0.25
      }),
    )
  })

  it('prior correct then correct: writes repeat_correct with zero points (no double-credit)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'repeat_correct',
        pointsAwarded: 0,
      }),
    )
  })

  it('prior correct then wrong: writes incorrect with zero points', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'incorrect',
        pointsAwarded: 0,
      }),
    )
  })

  it('persists generated question BEFORE writing mastery event', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const order: string[] = []
    persistGeneratedQuestionMock.mockImplementationOnce(async () => {
      order.push('persist')
      return { questionId: 'canonical-q-1', alreadyExisted: false }
    })
    writeMasteryEventMock.mockImplementationOnce(async () => {
      order.push('writeMastery')
      return {
        domain: 'history',
        points: 100,
        previousTier: 'establishing',
        newTier: 'establishing',
        tierChanged: false,
      }
    })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(order).toEqual(['persist', 'writeMastery'])
  })

  it('when persist fails, still records mastery event but with null eventQuestionId (graceful fallback)', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })
    persistGeneratedQuestionMock.mockRejectedValueOnce(new Error('persist boom'))

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventQuestionId: null,
        // Treated as first attempt because we can't look up history.
        answerState: 'first_correct',
        pointsAwarded: 100,
      }),
    )
    // No feed propagation without canonical id.
    expect(createFeedItemsForFriendsFromAnswerMock).not.toHaveBeenCalled()
  })
})
