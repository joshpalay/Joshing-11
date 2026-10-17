import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state, getRelationshipsMock, getForwardDiscoverableMock, DAILY_QUEUES } =
  vi.hoisted(() => {
    const state = { rows: [] as unknown[], queue: [] as unknown[] };

    function makeChain() {
      const chain: Record<string, unknown> = {};
      let table: unknown = null;
      for (const method of ['innerJoin', 'leftJoin', 'where', 'orderBy', 'groupBy']) {
        chain[method] = vi.fn(() => chain);
      }
      chain.from = vi.fn((t: unknown) => {
        table = t;
        return chain;
      });
      // limit() is the actual terminal call of getFriendActivity's main query;
      // nested notExists(db.select()...) subqueries never call limit(), so they
      // just get this same inert chain object back, which is fine -- they're
      // never awaited on their own.
      chain.limit = vi.fn(() => Promise.resolve(table === DAILY_QUEUES ? state.queue : state.rows));
      return chain;
    }

    const DAILY_QUEUES = { slots: 'dq.slots', userId: 'dq.userId', queueDate: 'dq.queueDate' };
    const dbMock = { select: vi.fn(() => makeChain()) };
    const getRelationshipsMock = vi.fn(async () => new Map());
    const getForwardDiscoverableMock = vi.fn(async () => new Set<string>());

    return { dbMock, state, getRelationshipsMock, getForwardDiscoverableMock, DAILY_QUEUES };
  });

vi.mock('@/server/db', () => ({
  db: dbMock,
  dailyQueues: DAILY_QUEUES,
  feedItems: {
    sourceUserId: 'feedItems.sourceUserId',
    recipientUserId: 'feedItems.recipientUserId',
    sourceType: 'feedItems.sourceType',
    sourceResult: 'feedItems.sourceResult',
    questionId: 'feedItems.questionId',
    sourceEventAt: 'feedItems.sourceEventAt',
    sourceAnswerId: 'feedItems.sourceAnswerId',
    joshingGameId: 'feedItems.joshingGameId',
    viaUserId: 'feedItems.viaUserId',
    state: 'feedItems.state',
  },
  follows: {
    followeeId: 'follows.followeeId',
    followerId: 'follows.followerId',
    state: 'follows.state',
  },
  masteryEvents: {},
  milestoneDismissed: {},
  questions: {
    id: 'questions.id',
    creatorId: 'questions.creatorId',
    generatedQuestionId: 'questions.generatedQuestionId',
  },
  users: { id: 'users.id', displayName: 'users.displayName' },
}));

vi.mock('@/server/db/queries/follow-visibility', () => ({
  approvedFollowExists: vi.fn(() => undefined),
  mutualFollowApproved: vi.fn(() => undefined),
}));

vi.mock('@/server/feed/visibility', () => ({
  ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES: ['direct_sent'],
  SOCIAL_FEED_SOURCE_TYPE: 'friend_answered',
  notBlocked: vi.fn(() => undefined),
  notBlockedForViewer: vi.fn(() => undefined),
}));

vi.mock('@/server/db/queries/friend-requests', () => ({
  getRelationships: getRelationshipsMock,
}));

vi.mock('@/server/db/queries/account', () => ({
  getForwardDiscoverable: getForwardDiscoverableMock,
}));

import { getFriendActivity } from '@/server/db/queries/lately';

const VIEWER = 'viewer-1';
const FRIEND = 'friend-1';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    friendId: FRIEND,
    friendDisplayName: 'Friend One',
    questionId: 'q1',
    sourceAnswerId: 'live:2026-09-10',
    joshingGameId: null,
    creatorId: null,
    generatedQuestionId: null,
    answeredAt: new Date('2026-09-10T12:00:00Z'),
    viaUserId: null,
    viaName: null,
    ...overrides,
  };
}

const slot = (overrides: Record<string, unknown>) => ({
  slot_index: 0,
  source: 'bot',
  domain: 'Food Chemistry & Cooking Science',
  question_text: 'What is the name of the chemical process of browning meat?',
  answered: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.queue = [];
});

// QA 2026-10-17 S2 (and 2026-10-12 S3): a question still waiting in the viewer's
// own Daily Five was also offered in From Friends, where "View Answer" records a
// give-up on it. It must stay out of From Friends until the viewer plays it.
describe("getFriendActivity hides questions in the viewer's own unplayed five", () => {
  it('drops an authored question that is an unplayed slot (Question id space)', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' }), row({ questionId: 'q3' })];
    state.queue = [{ slots: [slot({ question_id: 'q2' })] }];

    const cards = await getFriendActivity(VIEWER);

    expect(cards.flatMap((c) => c.questionIds).sort()).toEqual(['q1', 'q3']);
  });

  it('drops a bot question through its GeneratedQuestion twin', async () => {
    state.rows = [
      row({ questionId: 'q1' }),
      row({ questionId: 'q2', generatedQuestionId: 'g2' }),
      row({ questionId: 'q3' }),
    ];
    state.queue = [{ slots: [slot({ generated_question_id: 'g2' })] }];

    const cards = await getFriendActivity(VIEWER);

    expect(cards.flatMap((c) => c.questionIds).sort()).toEqual(['q1', 'q3']);
  });

  it('keeps questions the viewer already answered or skipped in their five', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];
    state.queue = [
      {
        slots: [
          slot({ question_id: 'q1', answered: true, answer_state: 'correct' }),
          slot({ slot_index: 1, question_id: 'q2', skipped: true }),
        ],
      },
    ];

    const cards = await getFriendActivity(VIEWER);

    expect(cards.flatMap((c) => c.questionIds).sort()).toEqual(['q1', 'q2']);
  });

  it('hides nothing when the viewer has no round today', async () => {
    state.rows = [row({ questionId: 'q1' }), row({ questionId: 'q2' })];

    const cards = await getFriendActivity(VIEWER);

    expect(cards.flatMap((c) => c.questionIds).sort()).toEqual(['q1', 'q2']);
  });
});
