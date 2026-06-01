import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkBankedQuestionsMock,
  dbMock,
  getDismissedDomainsMock,
  getFeedForUserMock,
  getSessionMock,
  state,
} = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const getFeedForUserMock = vi.fn();
  const getDismissedDomainsMock = vi.fn();
  const checkBankedQuestionsMock = vi.fn();
  const state = {
    questionRows: [] as Array<{
      id: string;
      questionText: string;
      answerText: string;
      creatorId: string;
      verified: boolean;
      explainerBrief: string | null;
      factualExplanation: string | null;
      canonicalSubcategory: string | null;
      broadCategory: string | null;
      category: string | null;
      calibratedDifficulty: string | null;
      llmDifficulty: string | null;
      difficultyEstimate: string | null;
    }>,
    userRows: [] as Array<{ id: string; displayName: string | null }>,
  };

  function thenable(rows: unknown[]) {
    return {
      where: vi.fn(() => thenable(rows)),
      innerJoin: vi.fn(() => ({ where: vi.fn(() => thenable(rows)) })),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
  }

  const dbMock = {
    select: vi.fn((selection?: unknown) => ({
      from: vi.fn((table: unknown) => {
        if (table === 'questions') {
          return thenable(state.questionRows);
        }
        if (
          (selection as { id?: unknown; displayName?: unknown })?.id &&
          (selection as { id?: unknown; displayName?: unknown })?.displayName
        ) {
          return thenable(state.userRows);
        }
        return thenable([{ value: 0 }]);
      }),
    })),
  };

  return {
    checkBankedQuestionsMock,
    dbMock,
    getDismissedDomainsMock,
    getFeedForUserMock,
    getSessionMock,
    state,
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  count: vi.fn(() => ({ expression: 'count' })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
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
    questionId: 'feedItems.questionId',
  },
  friendships: {
    status: 'friendships.status',
    userAId: 'friendships.userAId',
    userBId: 'friendships.userBId',
  },
  masteryEvents: {
    id: 'masteryEvents.id',
    userId: 'masteryEvents.userId',
    answeredByUserId: 'masteryEvents.answeredByUserId',
    questionId: 'masteryEvents.questionId',
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
    state.questionRows = [
      {
        id: 'question-1',
        questionText: 'What is the direct question?',
        answerText: 'Prince',
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
      },
    ];
    state.userRows = [
      { id: 'sender-1', displayName: 'Sender Friend' },
      { id: 'friend-1', displayName: 'Noah' },
      { id: 'author-1', displayName: 'Ari' },
    ];
    getFeedForUserMock.mockResolvedValue({
      items: [
        {
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
          answerResult: null,
          pointsAwarded: null,
          masteryDelta: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
  });

  it('includes direct_sent items in the API feed response', async () => {
    const response = await GET(new NextRequest('https://joshing.example/api/feed'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: 'feed-direct-1',
        card_type: 'direct_sent',
        source_type: 'direct_sent',
        state: 'active',
        is_pinned: true,
        personal_message: 'Try this one.',
        question_text: 'What is the direct question?',
        source_attribution: 'Sender Friend sent you a question — Music',
      }),
    ]);
    expect(body.meta.active_item_count).toBe(1);
    expect(body.meta.filter).toBe('all');
    expect(getFeedForUserMock).toHaveBeenCalledWith('recipient-1', {
      limit: 20,
      cursor: null,
      filter: 'all',
    });
  });

  it('returns answered Feed items as durable answered_by_you cards', async () => {
    getFeedForUserMock.mockResolvedValueOnce({
      items: [
        {
          id: 'feed-answered-1',
          questionId: 'question-1',
          joshingGameId: null,
          sourceType: 'direct_sent',
          sourceUserId: 'sender-1',
          sourceResult: null,
          sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
          personalMessage: 'Try this one.',
          submittedAnswer: 'Morris Day',
          answerResult: 'incorrect',
          pointsAwarded: 0,
          masteryDelta: { domain: 'Music', points: 0 },
          state: 'answered',
          isPinned: true,
        },
      ],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    const response = await GET(
      new NextRequest('https://joshing.example/api/feed?filter=sent-to-me'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        card_type: 'answered_by_you',
        state: 'answered',
        answer_result: 'incorrect',
        is_correct: false,
        submitted_answer: 'Morris Day',
        correct_answer: 'Prince',
        awarded_points: 0,
        mastery_delta: { domain: 'Music', points: 0 },
      }),
    );
    expect(getFeedForUserMock).toHaveBeenCalledWith('recipient-1', {
      limit: 20,
      cursor: null,
      filter: 'sent-to-me',
    });
  });

  it.each([
    [
      'friend_answered correct maps to friend-answered card type',
      'friend_answered',
      'correct',
      'friend_answered',
    ],
    ['authored_shared maps to friend-added card type', 'authored_shared', null, 'friend_added'],
    ['legacy thumbs_upped maps to friend-liked card type', 'thumbs_upped', null, 'friend_liked'],
  ] as const)('%s', async (_label, sourceType, sourceResult, cardType) => {
    getFeedForUserMock.mockResolvedValueOnce({
      items: [
        {
          id: `feed-${cardType}`,
          questionId: 'question-1',
          joshingGameId: null,
          sourceType,
          sourceUserId: sourceType === 'authored_shared' ? 'author-1' : 'friend-1',
          sourceResult,
          sourceEventAt: new Date('2026-05-14T12:05:00.000Z'),
          personalMessage: null,
          state: 'active',
          isPinned: false,
          submittedAnswer: null,
          answerResult: null,
          pointsAwarded: null,
          masteryDelta: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    const response = await GET(new NextRequest('https://joshing.example/api/feed'));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The wire payload carries the discriminator as `card_type`; the client
    // derives its own `type` from it (see toTypedFeedItem in FeedList), and
    // compactNulls strips `source_result` when it is null. So assert the
    // card_type mapping that drives card selection (e.g. authored_shared ->
    // friend_added -> the "Handwritten" envelope).
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        source_type: sourceType,
        card_type: cardType,
      }),
    );
    if (sourceResult !== null) {
      expect(body.items[0]).toEqual(expect.objectContaining({ source_result: sourceResult }));
    } else {
      expect(body.items[0]).not.toHaveProperty('source_result');
    }
  });

  it('omits suppressed category labels from Feed item payloads', async () => {
    state.questionRows = [
      {
        ...state.questionRows[0],
        canonicalSubcategory: 'Other',
        broadCategory: 'Uncategorized',
        category: 'Unknown',
      },
    ];

    const response = await GET(new NextRequest('https://joshing.example/api/feed'));
    const body = await response.json();

    expect(response.status).toBe(200);
    // compactNulls strips the suppressed (null) domain_pill from the wire.
    expect(body.items[0]).not.toHaveProperty('domain_pill');
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        source_attribution: 'Sender Friend sent you a question',
      }),
    );
  });

  it('keeps collapsed legacy endorsements on friend-liked cards', async () => {
    getFeedForUserMock.mockResolvedValueOnce({
      items: [
        {
          id: 'feed-liked-collapsed',
          questionId: 'question-1',
          joshingGameId: null,
          sourceType: 'thumbs_upped',
          sourceUserId: 'friend-1',
          sourceResult: null,
          sourceEventAt: new Date('2026-05-14T12:05:00.000Z'),
          personalMessage: null,
          state: 'active',
          isPinned: false,
          submittedAnswer: null,
          answerResult: null,
          pointsAwarded: null,
          masteryDelta: null,
          thumbsUpCount: 3,
          additionalEndorsers: [{ userId: 'sender-1', displayName: 'Sender Friend' }],
        },
      ],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    const response = await GET(new NextRequest('https://joshing.example/api/feed'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        card_type: 'friend_liked',
        endorsement_count: 3,
        additional_endorsers: [{ userId: 'sender-1', displayName: 'Sender Friend' }],
      }),
    );
  });

  it('rejects unsupported Feed filters', async () => {
    const response = await GET(
      new NextRequest('https://joshing.example/api/feed?filter=hidden-categories'),
    );
    await expect(response.json()).resolves.toEqual({ error: 'invalid_filter' });
    expect(response.status).toBe(400);
  });
});
