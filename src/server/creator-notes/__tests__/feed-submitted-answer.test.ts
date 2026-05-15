import { describe, expect, it, vi } from 'vitest';

const {
  dbMock,
  feedUpdateSetCalls,
  getSessionMock,
  gradeAnswerMock,
  generateBreadcrumbMock,
  writeMasteryEventMock,
  userAnsweredQuestionCorrectlyMock,
} = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  feedUpdateSetCalls: [] as unknown[],
  getSessionMock: vi.fn(),
  gradeAnswerMock: vi.fn(),
  generateBreadcrumbMock: vi.fn(),
  writeMasteryEventMock: vi.fn(),
  userAnsweredQuestionCorrectlyMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ op: 'inArray', left, values })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', parts, values })),
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: {
    id: 'feedItems.id',
    questionId: 'feedItems.questionId',
    sourceType: 'feedItems.sourceType',
    sourceResult: 'feedItems.sourceResult',
    recipientUserId: 'feedItems.recipientUserId',
    state: 'feedItems.state',
    submittedAnswer: 'feedItems.submittedAnswer',
  },
  questions: {
    id: 'questions.id',
    questionText: 'questions.questionText',
    answerText: 'questions.answerText',
    acceptedAlternatives: 'questions.acceptedAlternatives',
    questionType: 'questions.questionType',
    canonicalSubcategory: 'questions.canonicalSubcategory',
    broadCategory: 'questions.broadCategory',
    category: 'questions.category',
    calibratedDifficulty: 'questions.calibratedDifficulty',
    llmDifficulty: 'questions.llmDifficulty',
    explainerFull: 'questions.explainerFull',
    explainerBrief: 'questions.explainerBrief',
    factualExplanation: 'questions.factualExplanation',
    askedCount: 'questions.askedCount',
    correctCount: 'questions.correctCount',
    updatedAt: 'questions.updatedAt',
    creatorId: 'questions.creatorId',
  },
  playerMastery: {
    userId: 'playerMastery.userId',
    canonicalSubcategory: 'playerMastery.canonicalSubcategory',
  },
  joshingGameResponses: {
    gameId: 'joshingGameResponses.gameId',
    questionId: 'joshingGameResponses.questionId',
    userId: 'joshingGameResponses.userId',
    submittedAnswer: 'joshingGameResponses.submittedAnswer',
    isCorrect: 'joshingGameResponses.isCorrect',
    answeredAt: 'joshingGameResponses.answeredAt',
  },
  masteryEvents: {
    id: 'masteryEvents.id',
    userId: 'masteryEvents.userId',
    questionId: 'masteryEvents.questionId',
    answeredByUserId: 'masteryEvents.answeredByUserId',
    answerState: 'masteryEvents.answerState',
    sessionContext: 'masteryEvents.sessionContext',
  },
  users: {
    id: 'users.id',
    phoneNumber: 'users.phoneNumber',
    smsOptIn: 'users.smsOptIn',
    displayName: 'users.displayName',
  },
  smsLogs: {
    userId: 'smsLogs.userId',
    messageType: 'smsLogs.messageType',
    sentAt: 'smsLogs.sentAt',
  },
  creatorNotes: {},
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/grading', () => ({ gradeAnswer: gradeAnswerMock }));
vi.mock('@/server/daily/generate-breadcrumb', () => ({ generateBreadcrumb: generateBreadcrumbMock }));
vi.mock('@/server/mastery/write-mastery-event', () => ({ writeMasteryEvent: writeMasteryEventMock }));
vi.mock('@/server/mastery/scoring', () => ({ getBasePoints: vi.fn(() => 10) }));
vi.mock('@/server/db/queries/feed', () => ({ userAnsweredQuestionCorrectly: userAnsweredQuestionCorrectlyMock }));
vi.mock('@/server/sms', () => ({ sendSms: vi.fn() }));
vi.mock('@/server/activity/write-activity', () => ({ writeActivity: vi.fn() }));

function selectChain(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => result) })),
      })),
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({ limit: vi.fn(async () => result) })),
        limit: vi.fn(async () => result),
      })),
    })),
  };
}

function updateChain() {
  return {
    set: vi.fn((value: unknown) => {
      feedUpdateSetCalls.push(value);
      return { where: vi.fn(async () => []) };
    }),
  };
}

describe('Feed submitted answers for creator notes', () => {
  it('saves the submitted answer when a new Feed wrong answer is recorded', async () => {
    vi.clearAllMocks();
    feedUpdateSetCalls.length = 0;

    getSessionMock.mockResolvedValue({ userId: 'recipient-1' });
    gradeAnswerMock.mockResolvedValue({ result: 'wrong', consolation: null });
    generateBreadcrumbMock.mockResolvedValue(null);
    userAnsweredQuestionCorrectlyMock.mockResolvedValue(false);
    writeMasteryEventMock.mockResolvedValue({
      domain: 'Music',
      points: 0,
      previousTier: 'establishing',
      newTier: 'establishing',
      tierChanged: false,
    });

    dbMock.select
      .mockReturnValueOnce(selectChain([
        {
          feedItem: { id: 'feed-1', state: 'active' },
          question: {
            id: 'question-1',
            questionText: 'Who wrote the song?',
            answerText: 'Prince',
            acceptedAlternatives: [],
            questionType: 'factual',
            canonicalSubcategory: 'Music',
            broadCategory: 'Arts',
            category: 'Arts',
            calibratedDifficulty: null,
            llmDifficulty: null,
            explainerFull: null,
            explainerBrief: null,
            factualExplanation: null,
          },
        },
      ]))
      .mockReturnValueOnce(selectChain([]));

    dbMock.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
      update: vi.fn(() => updateChain()),
    }));

    const { POST } = await import('@/app/api/feed/[feedItemId]/answer/route');
    const response = await POST(
      new Request('http://localhost/api/feed/feed-1/answer', {
        method: 'POST',
        body: JSON.stringify({ submitted_answer: 'Morris Day' }),
      }) as never,
      { params: Promise.resolve({ feedItemId: 'feed-1' }) },
    );

    expect(response.status).toBe(200);
    expect(feedUpdateSetCalls).toContainEqual(expect.objectContaining({
      state: 'answered',
      submittedAnswer: 'Morris Day',
      answerResult: 'incorrect',
      pointsAwarded: 0,
    }));
  });

  it('returns the saved Feed submitted answer for creator-note context', async () => {
    vi.clearAllMocks();
    dbMock.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: 'feed-1', submittedAnswer: 'Morris Day' }]))
      .mockReturnValueOnce(selectChain([]));

    const { findWrongAnswerContext } = await import('@/server/creator-notes');
    await expect(findWrongAnswerContext('question-1', 'recipient-1')).resolves.toEqual({
      contextType: 'feed',
      contextId: 'feed-1',
      submittedAnswer: 'Morris Day',
    });
  });

  it('preserves the historical Feed fallback when no submitted answer was saved', async () => {
    vi.clearAllMocks();
    dbMock.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: 'old-feed-1', submittedAnswer: null }]))
      .mockReturnValueOnce(selectChain([]));

    const { findWrongAnswerContext } = await import('@/server/creator-notes');
    await expect(findWrongAnswerContext('question-1', 'recipient-1')).resolves.toMatchObject({
      contextType: 'feed',
      contextId: 'old-feed-1',
      submittedAnswer: null,
    });
  });

  it('keeps existing Joshing Game submitted-answer context unchanged', async () => {
    vi.clearAllMocks();
    dbMock.select.mockReturnValueOnce(selectChain([
      {
        contextId: 'game-1',
        submittedAnswer: 'Morris Day',
        answeredAt: new Date('2026-05-01T12:00:00.000Z'),
      },
    ]));

    const { findWrongAnswerContext } = await import('@/server/creator-notes');
    await expect(findWrongAnswerContext('question-1', 'recipient-1')).resolves.toEqual({
      contextType: 'joshing_game',
      contextId: 'game-1',
      submittedAnswer: 'Morris Day',
    });
  });
});
