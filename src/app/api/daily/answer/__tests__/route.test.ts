import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createFeedItemsForFriendsFromAnswerMock,
  getSessionMock,
  gradeAnswerMock,
  persistGeneratedQuestionMock,
  promoteDeclaredToDemonstratedMock,
  readPriorAnswersForQuestionMock,
  suggestAnswerMock,
  updateDomainDifficultyOnAnswerMock,
  writeMasteryEventMock,
  runMasteryWriteSideEffectsMock,
  dbState,
  selectCallChain,
  dbMock,
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
    // basePoints and difficultyEstimate are written together in production
    // (resolveDailyBasePoints(difficulty_estimate)); 100 ⇒ specialist. Keep
    // them consistent so the canonical scorer (which reads difficulty) matches.
    basePoints: 100,
    difficultyEstimate: 'specialist',
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

  // Drizzle chain mock: db.select().from().where().limit() — returns canned rows
  // based on which "table" was selected. We dispatch on the order of select()
  // calls within a single request: queue → question → persistedQuestion. Defined
  // inside vi.hoisted() so it's initialized before the hoisted vi.mock factory
  // below references it (otherwise: "Cannot access 'dbMock' before initialization").
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
    getSessionMock: vi.fn(async () => ({ userId: 'user-1', id: 's-1' })),
    gradeAnswerMock: vi.fn(),
    persistGeneratedQuestionMock: vi.fn(async () => ({
      questionId: 'canonical-q-1',
      alreadyExisted: false,
    })),
    promoteDeclaredToDemonstratedMock: vi.fn(),
    readPriorAnswersForQuestionMock: vi.fn(async () => []),
    suggestAnswerMock: vi.fn(),
    updateDomainDifficultyOnAnswerMock: vi.fn(async () => undefined),
    writeMasteryEventMock: vi.fn(async () => ({
      domain: 'history',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: false,
      eventInserted: true,
    })),
    runMasteryWriteSideEffectsMock: vi.fn(async () => undefined),
    dbState,
    selectCallChain,
    dbMock,
  }
})

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
  dailyQueues: { id: 'q.id', userId: 'q.userId' },
  generatedQuestions: { id: 'g.id', userId: 'g.userId', answer: 'g.answer' },
  questions: {
    id: 'q.id',
    creatorId: 'q.creatorId',
    canonicalSubcategory: 'q.cs',
    broadCategory: 'q.bc',
    category: 'q.c',
    insideJoke: 'q.ij',
  },
}))

vi.mock('@/server/mastery/write-mastery-event', () => ({
  writeMasteryEvent: writeMasteryEventMock,
  runMasteryWriteSideEffects: runMasteryWriteSideEffectsMock,
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
  // Reset and re-seed the select() responses in the order the route issues them
  // for a bot slot: dailyQueues (queue) → generatedQuestions (question) →
  // questions (persisted creator info, post-persist). The old PRD §8.4.3
  // "bot questions can only deepen existing domains" gate (a fourth
  // playerMastery select) has been removed (B-1) — a correct bot answer now
  // default-adds the domain via writeMasteryEvent, like the authored path.
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
      openedNewTerritory: false,
    })
  })

  it('first-time correct: writes first_correct with full base points and canonical eventQuestionId', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)

    expect(persistGeneratedQuestionMock).toHaveBeenCalledWith('gen-q-1', 'history')
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

  it('B-1: correct bot answer in an unfamiliar domain default-adds it (no §8.4.3 gate)', async () => {
    // No playerMastery row is seeded for this domain — under the old gate the
    // route would zero points and skip the mastery write. Now it must score
    // the answer fully and surface the freshly-opened territory.
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })
    writeMasteryEventMock.mockResolvedValueOnce({
      domain: 'history',
      points: 100,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
      openedNewTerritory: true,
    })

    const res = await POST(jsonRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)

    // Full points written, not zeroed for an "unknown domain".
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ answerState: 'first_correct', pointsAwarded: 100 }),
    )

    // The response carries the opened-territory signal the reveal undo reads.
    const body = await res.json()
    expect(body.pointsAwarded).toBe(100)
    expect(body.masteryDelta.openedNewTerritory).toBe(true)
    expect(body.masteryDelta.domain).toBe('history')
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
    // The route retries persistence once (persistAttempt < 2), so reject ALL
    // calls — not just the first — to exercise the full-failure fallback this
    // test asserts (canonicalQuestionId stays null → eventQuestionId null).
    persistGeneratedQuestionMock.mockRejectedValue(new Error('persist boom'))

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

describe('POST /api/daily/answer — slot identity guard (stale snapshot)', () => {
  // Regression: the client displays slot.question_text but only submits
  // slot_index; if the queue is re-indexed after load (a +2 bonus insert
  // re-sorts slots) the slot_index now holds a different question, and grading
  // would score the typed answer against the wrong question (answered Austerlitz,
  // marked wrong against Omaha Beach). expected_question_id pins the displayed
  // question so the server refuses to grade a mismatched slot.
  beforeEach(() => {
    vi.clearAllMocks()
    readPriorAnswersForQuestionMock.mockResolvedValue([])
  })

  it('grades normally when expected_question_id matches the slot FK', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const res = await POST(
      jsonRequest({ ...VALID_BODY, expected_question_id: 'gen-q-1' }) as never,
    )

    expect(res.status).toBe(200)
    expect(gradeAnswerMock).toHaveBeenCalled()
  })

  it('refuses to grade (409 slot_changed) and returns fresh slots when the FK no longer matches', async () => {
    // Only the queue select is reached — the guard returns before the question
    // lookup, so no grading / persistence / mastery side effects fire.
    selectCallChain.length = 0
    selectCallChain.push(async () => [dbState.queue])

    const res = await POST(
      jsonRequest({ ...VALID_BODY, expected_question_id: 'gen-q-STALE' }) as never,
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('slot_changed')
    expect(body.slots).toEqual(dbState.queue.slots)

    expect(gradeAnswerMock).not.toHaveBeenCalled()
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(writeMasteryEventMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/daily/answer grader outage (#6 — never score wrong on LLM failure)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readPriorAnswersForQuestionMock.mockResolvedValue([])
  })

  it('holds the answer for retry (503) and persists nothing when the grader is unreachable', async () => {
    setupDbChain()
    // gradeAnswer signals an unreachable LLM grader via status: 'unscored'.
    // There is NO result field — the route must refuse to score it rather than
    // penalise an infra outage.
    gradeAnswerMock.mockResolvedValueOnce({
      status: 'unscored',
      reason: 'llm_error',
    })

    const res = await POST(jsonRequest(VALID_BODY) as never)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('grader_unavailable')

    // The slot must stay untouched (unanswered) so the player can resubmit, and
    // no scoring side effects may fire.
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(writeMasteryEventMock).not.toHaveBeenCalled()
    expect(updateDomainDifficultyOnAnswerMock).not.toHaveBeenCalled()
    expect(createFeedItemsForFriendsFromAnswerMock).not.toHaveBeenCalled()
  })

  it('still scores give-ups as wrong (grader is skipped, so never held for retry)', async () => {
    setupDbChain()
    // gaveUp short-circuits gradeAnswer with gradedVia: 'exact', so this path
    // must persist a real wrong answer — the outage hold must not swallow it.
    const res = await POST(
      jsonRequest({ ...VALID_BODY, gave_up: true, submitted_answer: '' }) as never,
    )

    expect(res.status).toBe(200)
    expect(gradeAnswerMock).not.toHaveBeenCalled()
    expect(writeMasteryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ answerState: 'incorrect', pointsAwarded: 0 }),
    )
  })
})

describe('POST /api/daily/answer — acceptable variants reach the grader (B4 Phase 4 / Q4)', () => {
  // The generated-question row's acceptable_variants must flow into gradeAnswer
  // as acceptedAlternatives — this is the route half of the Q4 reuse chain (the
  // bank-copy half lives in bank-pick-field-preservation.test.ts, and grading's
  // variant fast-path in grading-fail-toward-player.test.ts). Before the Q4 fix,
  // reused bank rows arrived here with the column reset to [], so a right-but-
  // rephrased answer graded wrong on exactly the questions most likely to be
  // served at scale.
  it('passes the row acceptable_variants to gradeAnswer as acceptedAlternatives', async () => {
    selectCallChain.length = 0
    selectCallChain.push(async () => [dbState.queue])
    selectCallChain.push(async () => [
      { ...dbState.question, acceptableVariants: ['Answer A', 'The A'] },
    ])
    selectCallChain.push(async () => [dbState.persistedQuestion])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)

    expect(res.status).toBe(200)
    expect(gradeAnswerMock).toHaveBeenCalledWith(
      'A',
      'A',
      ['Answer A', 'The A'],
      'q?',
      'factual',
    )
  })

  it('defaults to no alternatives when the row has none (null column)', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(gradeAnswerMock).toHaveBeenCalledWith('A', 'A', [], 'q?', 'factual')
  })
})

describe('POST /api/daily/answer — questionType reaches the grader (B-GRADE-TYPE-01)', () => {
  // The grader's leniency policy branches on the question's stored type: a
  // 'personal' question grades against the creator's intended answer. Friend
  // slots (canonical questions) must pass the row's questionType — this route
  // used to hardcode 'factual', silently disabling the personal branch.
  it('passes the canonical row questionType for a friend slot (personal)', async () => {
    const friendQueue = {
      id: 'queue-1',
      userId: 'user-1',
      slots: [
        {
          slot_index: 0,
          source: 'friend',
          question_id: 'q-personal-1',
          domain: 'memories',
          question_text: 'Where did we first meet?',
          answered: false,
        },
      ],
    }
    const personalQuestion = {
      id: 'q-personal-1',
      deletedAt: null,
      questionText: 'Where did we first meet?',
      answerText: 'At the lake house',
      acceptedAlternatives: ['the lake'],
      questionType: 'personal',
      canonicalSubcategory: 'memories',
      broadCategory: 'personal',
      category: 'personal',
      explainerFull: null,
      explainerBrief: null,
      factualExplanation: null,
      calibratedDifficulty: null,
      llmDifficulty: null,
      difficultyEstimate: null,
      creatorId: 'author-1',
      insideJoke: null,
    }
    selectCallChain.length = 0
    selectCallChain.push(async () => [friendQueue])
    selectCallChain.push(async () => [personalQuestion])
    // Post-grade canonical-metadata read (creator info for author credit).
    selectCallChain.push(async () => [personalQuestion])
    gradeAnswerMock.mockResolvedValueOnce({ result: 'wrong', consolation: null })

    const res = await POST(jsonRequest(VALID_BODY) as never)

    expect(res.status).toBe(200)
    expect(gradeAnswerMock).toHaveBeenCalledWith(
      'A',
      'At the lake house',
      ['the lake'],
      'Where did we first meet?',
      'personal',
    )
  })

  it('still passes factual for a bot slot (generated questions are factual by construction)', async () => {
    setupDbChain()
    gradeAnswerMock.mockResolvedValueOnce({ result: 'correct', consolation: null })

    await POST(jsonRequest(VALID_BODY) as never)

    expect(gradeAnswerMock).toHaveBeenCalledWith('A', 'A', [], 'q?', 'factual')
  })
})
