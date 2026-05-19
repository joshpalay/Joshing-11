import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createFeedItemsForFriendsFromAnswerMock,
  getBasePointsMock,
  getSessionMock,
  gradeAnswerMock,
  promoteDeclaredToDemonstratedMock,
  promptCreatorNoteAfterWrongAnswerMock,
  readPriorAnswersForQuestionMock,
  selectQuipMock,
  writeMasteryEventMock,
} = vi.hoisted(() => ({
  createFeedItemsForFriendsFromAnswerMock: vi.fn(async () => undefined),
  getBasePointsMock: vi.fn((_difficulty: unknown, state: string) => {
    if (state === 'first_correct') return 100
    if (state === 'first_correct_after_wrong') return 25
    return 0
  }),
  getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
  gradeAnswerMock: vi.fn(),
  promoteDeclaredToDemonstratedMock: vi.fn(),
  promptCreatorNoteAfterWrongAnswerMock: vi.fn(),
  readPriorAnswersForQuestionMock: vi.fn(async () => []),
  selectQuipMock: vi.fn(() => 'quip'),
  writeMasteryEventMock: vi.fn(async () => ({
    domain: 'history',
    points: 0,
    previousTier: 'establishing',
    newTier: 'establishing',
    tierChanged: false,
    openedNewTerritory: false,
  })),
}))

const FEED_ROW = {
  feedItem: {
    id: 'feed-1',
    recipientUserId: 'user-1',
    sourceUserId: 'user-2',
    sourceResult: 'correct',
    questionId: 'canonical-q-1',
    state: 'visible',
  },
  question: {
    id: 'canonical-q-1',
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
    explainerFull: 'e',
    explainerBrief: null,
    factualExplanation: null,
  },
  sourceDisplayName: 'Friend',
}

// Drizzle chain mock — sequence: feed lookup, playerMastery lookup.
const selectCallChain: Array<() => Promise<unknown[]>> = []

function makeChainable() {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.leftJoin = () => chain
  chain.where = () => chain
  chain.limit = () => {
    const handler = selectCallChain.shift() ?? (async () => [])
    return handler()
  }
  return chain
}

const dbMock = {
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
}

vi.mock('@/server/grading', () => ({
  gradeAnswer: gradeAnswerMock,
  selectQuip: selectQuipMock,
}))

vi.mock('@/server/auth/session', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/server/creator-notes', () => ({
  promptCreatorNoteAfterWrongAnswer: promptCreatorNoteAfterWrongAnswerMock,
}))

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: {
    id: 'f.id',
    recipientUserId: 'f.recipient',
    sourceUserId: 'f.source',
    questionId: 'f.questionId',
  },
  playerMastery: { userId: 'p.userId', canonicalSubcategory: 'p.cs', tier: 'p.tier' },
  questions: {
    id: 'q.id',
    creatorId: 'q.creatorId',
    askedCount: 'q.askedCount',
    correctCount: 'q.correctCount',
  },
  users: { id: 'u.id', displayName: 'u.display' },
}))

vi.mock('@/server/mastery/scoring', () => ({
  getBasePoints: getBasePointsMock,
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

vi.mock('@/server/answer-state', async () => {
  const actual = await vi.importActual<typeof import('@/server/answer-state')>(
    '@/server/answer-state',
  )
  return actual
})

vi.mock('@/server/answer-history', () => ({
  readPriorAnswersForQuestion: readPriorAnswersForQuestionMock,
}))

import { POST } from '@/app/api/feed/[feedItemId]/answer/route'

function setupDbChain() {
  selectCallChain.length = 0
  selectCallChain.push(async () => [FEED_ROW])
  selectCallChain.push(async () => []) // playerMastery: none
}

function makeContext(feedItemId = 'feed-1') {
  return { params: Promise.resolve({ feedItemId }) }
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/feed/feed-1/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/feed/[feedItemId]/answer mastery scoring (F2.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readPriorAnswersForQuestionMock.mockResolvedValue([])
    writeMasteryEventMock.mockResolvedValue({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: false,
    })
  })

  it('first-time correct: first_correct + full points + canonical eventQuestionId', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(readPriorAnswersForQuestionMock).toHaveBeenCalledWith('user-1', 'canonical-q-1')
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct',
        pointsAwarded: 100,
        eventQuestionId: 'canonical-q-1',
        weight: 1,
      }),
    )
  })

  it('first-time wrong: writes incorrect with 0 points', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'incorrect',
        pointsAwarded: 0,
        weight: 0,
      }),
    )
  })

  it('prior wrong then correct: first_correct_after_wrong with 0.25x base credit (F2.3 fix)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'wrong' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'first_correct_after_wrong',
        pointsAwarded: 25,
      }),
    )
  })

  it('prior correct then correct: repeat_correct with 0 points (no double-credit)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'repeat_correct',
        pointsAwarded: 0,
        weight: 0,
      }),
    )
  })

  it('prior correct then wrong: incorrect with 0 points', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        answerState: 'incorrect',
        pointsAwarded: 0,
      }),
    )
  })

  it('triggers promoteDeclaredToDemonstrated on recovery (not just first_correct)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'wrong' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(promoteDeclaredToDemonstratedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'author-1',
        questionId: 'canonical-q-1',
      }),
    )
  })

  it('does NOT trigger promote on repeat_correct (already demonstrated)', async () => {
    setupDbChain()
    readPriorAnswersForQuestionMock.mockResolvedValueOnce([{ result: 'correct' }])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest({ submitted_answer: 'A' }) as never, makeContext())

    expect(promoteDeclaredToDemonstratedMock).not.toHaveBeenCalled()
  })
})
