import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getLatelyMoments dedup (claude/duplicate-recent-activity): a question can be
// answered correctly more than once (re-sent as a direct question, replayed,
// re-encountered organically), producing multiple correct masteryEvents for the
// same (direction, friend, question) triple. Each carries a distinct momentId,
// so left un-deduped they render as the SAME moment TWICE in Recent Activity,
// each picking a different copy line off its id. These tests drive controlled
// rows through the post-query loop and assert one moment per triple.

let rows: Array<Record<string, unknown>> = [];

vi.mock('drizzle-orm', () => {
  const noop = (...args: unknown[]) => ({ args });
  return {
    and: noop,
    desc: noop,
    eq: noop,
    gte: noop,
    inArray: noop,
    isNotNull: noop,
    isNull: noop,
    ne: noop,
    notExists: noop,
    or: noop,
    sql: Object.assign(vi.fn(() => ({ as: vi.fn(() => ({})) })), { raw: vi.fn() }),
  };
});

vi.mock('drizzle-orm/pg-core', () => ({ alias: vi.fn(() => ({})) }));

vi.mock('@/server/feed/visibility', () => ({
  ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES: [],
  SOCIAL_FEED_SOURCE_TYPE: 'social',
  notBlockedForViewer: vi.fn(() => ({})),
}));

vi.mock('@/server/db/queries/follow-visibility', () => ({
  approvedFollowExists: vi.fn(() => ({})),
}));

vi.mock('@/server/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'where', 'orderBy']) chain[m] = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  const tableProxy = new Proxy({}, { get: (_t, prop) => String(prop) });
  return {
    db: { select: vi.fn(() => chain) },
    feedItems: tableProxy,
    follows: tableProxy,
    masteryEvents: tableProxy,
    questions: tableProxy,
    users: tableProxy,
  };
});

import { getLatelyMoments } from '@/server/db/queries/lately';

const VIEWER = 'viewer-1';

// One masteryEvents-joined row as the query selects it. `creatorId === VIEWER`
// → they_got_you (a friend answered the viewer's question).
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    momentId: 'me-1',
    creatorId: VIEWER,
    answererId: 'friend-1',
    friendId: 'friend-1',
    friendDisplayName: 'Rog Palay',
    questionId: 'q-1',
    questionText: 'What epic poem starts "Of man\'s first disobedience"?',
    canonicalSubcategory: 'Paradise Lost',
    category: 'Literature',
    answeredAt: new Date('2026-06-30T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  rows = [];
});
afterEach(() => vi.clearAllMocks());

describe('getLatelyMoments collapses duplicate answering events', () => {
  it('renders ONE moment when the same friend answered the same question correctly twice', async () => {
    // Two correct masteryEvents for the same (they_got_you, friend-1, q-1)
    // triple — newest first, as the query orders them.
    rows = [
      row({ momentId: 'me-newer', answeredAt: new Date('2026-06-30T12:00:00Z') }),
      row({ momentId: 'me-older', answeredAt: new Date('2026-06-20T09:00:00Z') }),
    ];
    const moments = await getLatelyMoments(VIEWER);
    expect(moments).toHaveLength(1);
    // Keeps the most recent event (first in createdAt-desc order).
    expect(moments[0]!.momentId).toBe('me-newer');
    expect(moments[0]!.answeredAt).toEqual(new Date('2026-06-30T12:00:00Z'));
  });

  it('keeps distinct friends who each answered the same question', async () => {
    rows = [
      row({ momentId: 'me-a', friendId: 'friend-1', answererId: 'friend-1' }),
      row({ momentId: 'me-b', friendId: 'friend-2', answererId: 'friend-2', friendDisplayName: 'Sam' }),
    ];
    const moments = await getLatelyMoments(VIEWER);
    expect(moments).toHaveLength(2);
    expect(new Set(moments.map((m) => m.friendId))).toEqual(new Set(['friend-1', 'friend-2']));
  });

  it('keeps distinct questions from the same friend', async () => {
    rows = [
      row({ momentId: 'me-a', questionId: 'q-1' }),
      row({ momentId: 'me-b', questionId: 'q-2' }),
    ];
    const moments = await getLatelyMoments(VIEWER);
    expect(moments).toHaveLength(2);
    expect(new Set(moments.map((m) => m.questionId))).toEqual(new Set(['q-1', 'q-2']));
  });

  it('keeps both directions for the same friend+question (they_got_you vs you_got_them)', async () => {
    // they_got_you: viewer authored, friend answered. you_got_them: friend
    // authored, viewer answered. Different questions in practice, but the key
    // must not collapse across directions even if IDs collide.
    rows = [
      row({ momentId: 'me-a', creatorId: VIEWER, friendId: 'friend-1', answererId: 'friend-1' }),
      row({ momentId: 'me-b', creatorId: 'friend-1', friendId: 'friend-1', answererId: VIEWER }),
    ];
    const moments = await getLatelyMoments(VIEWER);
    expect(moments).toHaveLength(2);
    expect(new Set(moments.map((m) => m.dir))).toEqual(new Set(['they_got_you', 'you_got_them']));
  });
});
