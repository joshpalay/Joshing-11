import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkBankedQuestionsMock, dbMock, getDismissedDomainsMock, getFeedForUserMock, getSessionMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const getFeedForUserMock = vi.fn();
  const getDismissedDomainsMock = vi.fn();
  const checkBankedQuestionsMock = vi.fn();

  function thenable(rows: unknown[]) {
    return {
      where: vi.fn(() => thenable(rows)),
      innerJoin: vi.fn(() => ({ where: vi.fn(() => thenable(rows)) })),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
  }

  const dbMock = {
    select: vi.fn((selection?: unknown) => ({
      from: vi.fn((table: unknown) => {
        if (table === 'questions') {
          return thenable([{
            id: 'question-1',
            questionText: 'What is the direct question?',
            creatorId: 'sender-1',
            verified: true,
            explainerBrief: 'A brief explanation.',
            factualExplanation: null,
            canonicalSubcategory: 'Music',
            broadCategory: 'Arts',
            category: 'music',
            calibratedDifficulty: null,
            llmDifficulty: null,
            difficultyEstimate: null,
            answerText: 'Correct answer',
            explainerFull: 'A stored full explanation.',
          }]);
        }
        if ((selection as { answerId?: unknown })?.answerId) {
          return thenable([{
            answerId: 'feed:feed-answered-1:question-1:recipient-1',
            answerState: 'incorrect',
            awardedPoints: 0,
            basePoints: 0,
          }]);
        }
        if ((selection as { canonicalSubcategory?: unknown; totalPoints?: unknown; tier?: unknown })?.canonicalSubcategory) {
          return thenable([{ canonicalSubcategory: 'Music', totalPoints: 12, tier: 'familiar' }]);
        }
        if ((selection as { id?: unknown; displayName?: unknown })?.id && (selection as { id?: unknown; displayName?: unknown })?.displayName) {
          return thenable([
            { id: 'sender-1', displayName: 'Sender Friend' },
          ]);
        }
        return thenable([{ value: 0 }]);
      }),
    })),
  };

  return { checkBankedQuestionsMock, dbMock, getDismissedDomainsMock, getFeedForUserMock, getSessionMock };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  count: vi.fn(() => ({ expression: 'count' })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
}));

vi.mock('@/server/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/server/db/queries/bank', () => ({ checkBankedQuestions: checkBankedQuestionsMock }));
vi.mock('@/server/db/queries/feed', () => ({
  getDismissedDomains: getDismissedDomainsMock,
  getFeedForUser: getFeedForUserMock,
  visibleFeedSourcePredicate: { op: 'visibleFeedSourcePredicate' },
}));
vi.mock('@/server/db', () => ({
  db: dbMock,
  feedItems: {
    recipientUserId: 'feedItems.recipientUserId',
    state: 'feedItems.state',
    sourceType: 'feedItems.sourceType',
    sourceResult: 'feedItems.sourceResult',
  },
  friendships: {
    status: 'friendships.status',
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
  },
  masteryEvents: {
    answerId: 'masteryEvents.answerId',
    answerState: 'masteryEvents.answerState',
    awardedPoints: 'masteryEvents.awardedPoints',
    basePoints: 'masteryEvents.basePoints',
  },
  playerMastery: {
    userId: 'playerMastery.userId',
    canonicalSubcategory: 'playerMastery.canonicalSubcategory',
    totalPoints: 'playerMastery.totalPoints',
    tier: 'playerMastery.tier',
  },
  questions: 'questions',
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
  },
}));

import { GET } from '@/app/api/feed/route';

describe('GET /api/feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'recipient-1' });
    getDismissedDomainsMock.mockResolvedValue([]);
    checkBankedQuestionsMock.mockResolvedValue({});
    getFeedForUserMock.mockResolvedValue({
      items: [{
        id: 'feed-direct-1',
        questionId: 'question-1',
        joshingGameId: null,
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: 'Try this one.',
        state: 'active',
        isPinned: true,
        submittedAnswer: null,
        quip: null,
      }],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
  });

  it('includes direct_sent items in the API feed response', async () => {
    const response = await GET(new Request('https://joshing.example/api/feed') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: 'feed-direct-1',
        card_type: 'direct_sent',
        type: 'direct_sent',
        source_type: 'direct_sent',
        state: 'active',
        is_pinned: true,
        personal_message: 'Try this one.',
        question_text: 'What is the direct question?',
        source_attribution: 'Sender Friend sent you a question — Music',
      }),
    ]);
    expect(body.meta.active_item_count).toBe(1);
  });

  it('passes the Feed filter query param to the feed query', async () => {
    const response = await GET(new Request('https://joshing.example/api/feed?filter=sent-to-me') as never);

    expect(response.status).toBe(200);
    expect(getFeedForUserMock).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ filter: 'sent-to-me' }));
  });

  it('returns durable answered_by_you card data for answered Feed items', async () => {
    getFeedForUserMock.mockResolvedValueOnce({
      items: [{
        id: 'feed-answered-1',
        questionId: 'question-1',
        joshingGameId: null,
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: 'Try this one.',
        state: 'answered',
        isPinned: true,
        submittedAnswer: 'My wrong answer',
        quip: 'Not quite.',
      }],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    const response = await GET(new Request('https://joshing.example/api/feed') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toEqual(expect.objectContaining({
      card_type: 'answered_by_you',
      type: 'answered_by_you',
      state: 'answered',
      is_pinned: false,
      original_source: expect.objectContaining({ source_type: 'direct_sent' }),
      answered_by_you: expect.objectContaining({
        correct: false,
        answer_state: 'incorrect',
        correct_answer: 'Correct answer',
        submitted_answer: 'My wrong answer',
        awarded_points: 0,
        explanation: 'A stored full explanation.',
        quip: 'Not quite.',
      }),
      mastery_progress: expect.objectContaining({ domain: 'Music', total_points: 12, tier: 'familiar' }),
    }));
  });

  it('rejects unsupported Feed filters', async () => {
    const response = await GET(new Request('https://joshing.example/api/feed?filter=hidden-categories') as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_filter');
  });
});
