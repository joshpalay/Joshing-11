import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createFeedItemsForFriendsFromAnswerMock,
  dbMock,
  getCatchupQuestionsMock,
  getSessionMock,
  gradeAnswerMock,
  persistGeneratedQuestionMock,
  promoteDeclaredToDemonstratedMock,
  readPriorAnswersForQuestionMock,
  selectCallChain,
  updateDomainDifficultyOnAnswerMock,
  writeMasteryEventMock,
} = vi.hoisted(() => {
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
  return {
    createFeedItemsForFriendsFromAnswerMock: vi.fn(async () => undefined),
    dbMock,
    getCatchupQuestionsMock: vi.fn(),
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
    persistGeneratedQuestionMock: vi.fn(async () => ({
      questionId: 'canonical-q-1',
      alreadyExisted: false,
    })),
    promoteDeclaredToDemonstratedMock: vi.fn(),
    readPriorAnswersForQuestionMock: vi.fn(async () => []),
    selectCallChain,
    updateDomainDifficultyOnAnswerMock: vi.fn(async () => undefined),
    writeMasteryEventMock: vi.fn(async () => ({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: false,
    })),
  }
})

const CATCHUP_ITEM = {
  dailyQueueItemId: 'queue-1:0',
  surface: 'daily' as const,
  queueId: 'queue-1',
  slotIndex: 0,
  feedItemId: null,
  questionId: 'gen-q-1',
  questionText: 'q?',
  correctAnswer: 'A',
  alternateAnswers: [],
  explanation: 'e',
  domain: 'history',
  broadCategory: 'humanities',
  basePoints: 100,
  difficultyEstimate: 'specialist' as const,
}

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

const PERSISTED_QUESTION = {
  creatorId: 'author-1',
  domain: 'history',
  broadCategory: 'humanities',
  category: 'humanities',
}

vi.mock('@/server/grading', () => ({
  gradeAnswer: gradeAnswerMock,
}))

vi.mock('@/server/adaptive-difficulty', () => ({
  updateDomainDifficultyOnAnswer: updateDomainDifficultyOnAnswerMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  dailyQueues: { id: 'q.id' },
  feedItems: {
    id: 'f.id',
    recipientUserId: 'f.recipient',
    questionId: 'f.questionId',
    catchupResolvedAt: 'f.catchupResolvedAt',
    answerResult: 'f.answerResult',
    submittedAnswer: 'f.submittedAnswer',
    state: 'f.state',
    sourceEventAt: 'f.sourceEventAt',
  },
  questions: {
    id: 'q.id',
    creatorId: 'q.creatorId',
    canonicalSubcategory: 'q.cs',
    broadCategory: 'q.bc',
    category: 'q.c',
  },
}))

vi.mock('@/server/db/queries/daily', () => ({
  getCatchupQuestions: getCatchupQuestionsMock,
}))

vi.mock('@/server/daily/catchup', () => ({
  asQueueSlots: (v: unknown) => (Array.isArray(v) ? v : []),
  findQueueSlotBySlotIndex: (slots: { slot_index: number }[], idx: number) =>
    slots.find((s) => s.slot_index === idx),
  replaceQueueSlot: (slots: { slot_index: number }[], idx: number, fn: (s: unknown) => unknown) =>
    slots.map((s) => (s.slot_index === idx ? fn(s) : s)),
  parseCatchupItemId: (id: string) => {
    if (id.startsWith('feed:')) return { surface: 'feed', feedItemId: id.slice(5) }
    const [queueId, slotIndexValue] = id.split(':')
    return { surface: 'daily', queueId, slotIndex: Number(slotIndexValue) }
  },
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

vi.mock('@/server/play/catch-up-submit-error', () => ({
  catchUpErrorResponse: (status: number, code: string, message?: string) =>
    Response.json({ error: code, message }, { status }),
}))

vi.mock('@/server/answer-state', async () => {
  const actual = await vi.importActual<typeof import('@/server/answer-state')>(
    '@/server/answer-state',
  )
  return actual
})

vi.mock('@/server/answer-history', () => ({
  readPriorAnswersForQuestion: readPriorAnswersForQuestionMock,
}))

import { POST } from '@/app/api/daily/catchup/answer/route'

function setupDbChain() {
  selectCallChain.length = 0
  // 1: queue lookup; 2: persistedQuestion lookup
  selectCallChain.push(async () => [QUEUE])
  selectCallChain.push(async () => [PERSISTED_QUESTION])
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/daily/catchup/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  dailyQueueItemId: 'queue-1:0',
  submittedAnswer: 'A',
}

describe('POST /api/daily/catchup/answer mastery scoring (F2.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCatchupQuestionsMock.mockResolvedValue([CATCHUP_ITEM])
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
      openedNewTerritory: false,
    })
  })

  it('first-time correct catch-up: writes first_correct with 25% of base points', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(persistGeneratedQuestionMock).toHaveBeenCalledWith('gen-q-1', 'history')
    expect(readPriorAnswersForQuestionMock).toHaveBeenCalledWith('user-1', 'canonical-q-1')
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct',
        pointsAwarded: 25, // 100 * 0.25 surface weight
        eventQuestionId: 'canonical-q-1',
        sourceType: 'catchup',
      }),
    )
  })

  it('first-time wrong catch-up: writes incorrect with zero points', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'incorrect',
        pointsAwarded: 0,
      }),
    )
  })

  it('prior wrong then correct catch-up: writes first_correct_after_wrong with RECOVERY_STATE_WEIGHT × full base', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'wrong' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct_after_wrong',
        // Recovery on catch-up = RECOVERY_STATE_WEIGHT (0.25) applied to the
        // full base, not the already-reduced catch-up base. See route comment
        // at handleDailyCatchupAnswer: round(100 * 0.25) = 25.
        pointsAwarded: 25,
      }),
    )
  })

  it('prior correct then correct catch-up: writes repeat_correct with zero points', async () => {
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
        points: 25,
        previousTier: 'establishing',
        newTier: 'establishing',
        tierChanged: false,
      }
    })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(order).toEqual(['persist', 'writeMastery'])
  })

  it('reveals creatorNote + provenance-calibrated aside on the catch-up response (B-7)', async () => {
    selectCallChain.length = 0
    selectCallChain.push(async () => [QUEUE])
    // Self-authored (creatorId === viewer) resolves the relational label
    // without a friendship lookup, exercising selectInsideJokeForViewer.
    selectCallChain.push(async () => [
      {
        creatorId: 'user-1',
        domain: 'history',
        broadCategory: 'humanities',
        category: 'humanities',
        insideJoke: 'between us, you nailed this last time',
        creatorNote: 'wrote this after our trivia night',
      },
    ])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const response = await POST(jsonRequest(VALID_BODY) as never)
    const body = await response.json()

    expect(body.insideJoke).toBe('between us, you nailed this last time')
    expect(body.insideJokeKind).toBe('relational')
    expect(body.creatorNote).toBe('wrote this after our trivia night')
  })

  it('hides the aside but still reveals creatorNote when the answer is wrong (one-directional reveal)', async () => {
    selectCallChain.length = 0
    selectCallChain.push(async () => [QUEUE])
    selectCallChain.push(async () => [
      {
        creatorId: 'user-1',
        domain: 'history',
        broadCategory: 'humanities',
        category: 'humanities',
        insideJoke: 'between us',
        creatorNote: 'a note',
      },
    ])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    const response = await POST(jsonRequest(VALID_BODY) as never)
    const body = await response.json()

    // Reveal is one-directional: shown on correct OR incorrect, per B-3.
    expect(body.insideJoke).toBe('between us')
    expect(body.insideJokeKind).toBe('relational')
    expect(body.creatorNote).toBe('a note')
  })

  it('graceful fallback when persist fails on every retry: mastery event still written with null eventQuestionId', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })
    // Route retries persistGeneratedQuestion once on failure; reject both
    // attempts to exercise the graceful-fallback branch.
    persistGeneratedQuestionMock.mockRejectedValueOnce(new Error('persist boom'))
    persistGeneratedQuestionMock.mockRejectedValueOnce(new Error('persist boom retry'))

    await POST(jsonRequest(VALID_BODY) as never)

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventQuestionId: null,
        answerState: 'first_correct',
        pointsAwarded: 25,
      }),
    )
    expect(createFeedItemsForFriendsFromAnswerMock).not.toHaveBeenCalled()
  })
})
