import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-GRADE-TYPE-01: the replay path used to hardcode questionType 'factual',
// silently disabling the grader's personal-question leniency for friend-
// authored slots replayed after a wrong answer. ReplayItem now carries the
// stored questionType and the route must forward it.

const {
  dbMock,
  generateBreadcrumbMock,
  getReplayWrongQuestionsMock,
  getSessionMock,
  gradeAnswerMock,
  writeMasteryEventMock,
} = vi.hoisted(() => {
  const QUEUE = {
    id: 'queue-1',
    userId: 'user-1',
    slots: [
      {
        slot_index: 0,
        source: 'friend',
        question_id: 'q-personal-1',
        domain: 'memories',
        question_text: 'Where did we first meet?',
        answered: true,
        answer_state: 'incorrect',
      },
    ],
  }
  const dbMock = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [QUEUE],
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: vi.fn(async () => undefined),
      }),
    })),
  }
  return {
    dbMock,
    generateBreadcrumbMock: vi.fn(async () => null),
    getReplayWrongQuestionsMock: vi.fn(),
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
    writeMasteryEventMock: vi.fn(async () => ({
      domain: 'memories',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: false,
    })),
  }
})

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }))
vi.mock('@/server/db', () => ({ db: dbMock, dailyQueues: { id: 'q.id' } }))
vi.mock('@/server/db/queries/replay', () => ({
  getReplayWrongQuestions: getReplayWrongQuestionsMock,
}))
vi.mock('@/server/grading', () => ({ gradeAnswer: gradeAnswerMock }))
vi.mock('@/server/daily/generate-breadcrumb', () => ({
  generateBreadcrumb: generateBreadcrumbMock,
}))
vi.mock('@/server/mastery/write-mastery-event', () => ({
  writeMasteryEvent: writeMasteryEventMock,
}))

import { POST } from '@/app/api/replay/grade/route'

const REPLAY_ITEM = {
  dailyQueueItemId: 'queue-1:0',
  queueDate: '2026-06-10',
  slotIndex: 0,
  questionId: 'q-personal-1',
  questionText: 'Where did we first meet?',
  correctAnswer: 'At the lake house',
  alternateAnswers: ['the lake'],
  explanation: null,
  domain: 'memories',
  domainDisplayName: 'Memories',
  originalSubmittedAnswer: 'the park',
  questionType: 'personal' as const,
  authorName: 'Sam',
  authorIsHouse: false,
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/replay/grade', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/replay/grade — questionType reaches the grader (B-GRADE-TYPE-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getReplayWrongQuestionsMock.mockResolvedValue([REPLAY_ITEM])
  })

  it('forwards the replay item stored questionType (personal) to gradeAnswer', async () => {
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    const res = await POST(jsonRequest({ dailyQueueItemId: 'queue-1:0', submittedAnswer: 'the beach' }) as never)

    expect(res.status).toBe(200)
    expect(gradeAnswerMock).toHaveBeenCalledWith(
      'the beach',
      'At the lake house',
      ['the lake'],
      'Where did we first meet?',
      'personal',
    )
  })

  it('forwards factual for bot-origin replay items', async () => {
    getReplayWrongQuestionsMock.mockResolvedValue([
      { ...REPLAY_ITEM, questionType: 'factual' as const, authorName: null },
    ])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    await POST(jsonRequest({ dailyQueueItemId: 'queue-1:0', submittedAnswer: 'the beach' }) as never)

    expect(gradeAnswerMock).toHaveBeenCalledWith(
      'the beach',
      'At the lake house',
      ['the lake'],
      'Where did we first meet?',
      'factual',
    )
  })
})
