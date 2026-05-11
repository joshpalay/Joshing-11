import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, selectMock, updateMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db', () => ({
  dailyQueues: { id: 'dailyQueues.id', userId: 'dailyQueues.userId' },
  generatedQuestions: {
    id: 'generatedQuestions.id',
    userId: 'generatedQuestions.userId',
  },
  questions: {
    id: 'questions.id',
    creatorId: 'questions.creatorId',
    canonicalSubcategory: 'questions.canonicalSubcategory',
    broadCategory: 'questions.broadCategory',
    category: 'questions.category',
  },
  db: {
    select: selectMock,
    update: updateMock,
  },
}))
vi.mock('@/server/grading', () => ({
  gradeAnswer: vi.fn(),
  selectQuip: vi.fn(),
}))
vi.mock('@/server/adaptive-difficulty', () => ({
  updateDomainDifficultyOnAnswer: vi.fn(),
}))
vi.mock('@/server/daily/generate-breadcrumb', () => ({
  generateBreadcrumb: vi.fn(),
}))
vi.mock('@/server/mastery/write-mastery-event', () => ({
  writeMasteryEvent: vi.fn(),
}))
vi.mock('@/server/feed/create-feed-items-for-answer', () => ({
  createFeedItemsForFriendsFromAnswer: vi.fn(),
}))
vi.mock('@/server/knowledge/open-domain', () => ({
  promoteDeclaredToDemonstrated: vi.fn(),
}))
vi.mock('@/server/questions/persist-generated-question', () => ({
  persistGeneratedQuestion: vi.fn(),
}))

import { POST } from '@/app/api/daily/answer/route'

function selectBuilder(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  }
}

function answerRequest(body: unknown) {
  return new Request('http://localhost/api/daily/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('/api/daily/answer failure responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateMock.mockReturnValue({
      set: vi
        .fn()
        .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })
  })

  it('returns a user-safe message for unauthorized users', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await POST(
      answerRequest({
        queue_id: 'queue-1',
        slot_index: 0,
        submitted_answer: 'Paris',
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'unauthorized',
      message: "Please sign in to answer today's question.",
    })
  })

  it('returns a user-safe message when the daily queue is not found', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1' })
    selectMock.mockReturnValueOnce(selectBuilder([]))

    const response = await POST(
      answerRequest({
        queue_id: 'queue-1',
        slot_index: 0,
        submitted_answer: 'Paris',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'not_found',
      message: "Could not find today's Daily Five queue.",
    })
  })

  it('returns a user-safe message when the generated question is not found', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user-1' })
    selectMock
      .mockReturnValueOnce(
        selectBuilder([
          {
            id: 'queue-1',
            slots: [
              {
                answered: false,
                skipped: false,
                generated_question_id: 'generated-question-1',
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(selectBuilder([]))

    const response = await POST(
      answerRequest({
        queue_id: 'queue-1',
        slot_index: 0,
        submitted_answer: 'Paris',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'question_not_found',
      message: 'Could not find the question for this Daily Five slot.',
    })
  })

  it('returns a user-safe message for unexpected exceptions', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    getSessionMock.mockRejectedValue(new Error('database unavailable'))

    const response = await POST(
      answerRequest({
        queue_id: 'queue-1',
        slot_index: 0,
        submitted_answer: 'Paris',
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'unexpected',
      message: 'Could not record that answer right now.',
    })
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
