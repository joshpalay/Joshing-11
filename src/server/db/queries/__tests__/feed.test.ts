import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state } = vi.hoisted(() => {
  type Predicate =
    | { op: 'eq'; column: string; value: unknown }
    | { op: 'ne'; column: string; value: unknown }
    | { op: 'and'; predicates: Array<Predicate | undefined> }
    | { op: 'or'; predicates: Array<Predicate | undefined> }
    | { op: 'inArray'; column: string; values: readonly unknown[] }
    | { op: 'isNull'; column: string }
    | { op: 'notInArray'; column: string; values: readonly unknown[] }
    | { op: 'notExists' }
    | { op: 'exists' }
    | { op: 'lt'; column: string; value: unknown };

  type FeedRow = {
    id: string;
    recipientUserId: string;
    questionId: string;
    sourceType: string;
    sourceUserId: string;
    sourceResult: string | null;
    sourceEventAt: Date;
    personalMessage: string | null;
    state: string;
    isPinned: boolean;
    joshingGameId: string | null;
  };

  type QuestionRow = {
    id: string;
    visibility: string;
    deletedAt: Date | null;
    canonicalSubcategory: string | null;
    creatorId?: string | null;
  };

  const state = {
    feedRows: [] as FeedRow[],
    questionRows: [] as QuestionRow[],
  };

  function columnValue(column: string, feedItem: FeedRow, question: QuestionRow | undefined) {
    if (column.startsWith('feedItems.')) return feedItem[column.slice('feedItems.'.length) as keyof FeedRow];
    if (column.startsWith('questions.')) return question?.[column.slice('questions.'.length) as keyof QuestionRow];
    return undefined;
  }

  function evaluate(predicate: Predicate | undefined, feedItem: FeedRow, question: QuestionRow | undefined): boolean {
    if (!predicate) return true;
    switch (predicate.op) {
      case 'eq':
        return columnValue(predicate.column, feedItem, question) === predicate.value;
      case 'ne': {
        const v = columnValue(predicate.column, feedItem, question);
        // SQL: `x != y` is NULL when x is NULL, which is falsy in WHERE.
        return v != null && v !== predicate.value;
      }
      case 'and':
        return predicate.predicates.every((part) => evaluate(part, feedItem, question));
      case 'or':
        return predicate.predicates.some((part) => evaluate(part, feedItem, question));
      case 'inArray':
        return predicate.values.includes(columnValue(predicate.column, feedItem, question));
      case 'isNull':
        return columnValue(predicate.column, feedItem, question) == null;
      case 'notInArray':
        return !predicate.values.includes(columnValue(predicate.column, feedItem, question));
      case 'notExists':
        // The tests don't model the masteryEvents table; treat the
        // viewer-not-already-answered subquery as always passing so the
        // existing visibility cases continue to drive what's exercised here.
        return true;
      case 'exists':
        // The tests don't model the follows table; treat the
        // viewer-follows-author subquery (D-1 Stage 4 'friends' gate) as
        // passing. Existing cases use 'public' visibility, so this only
        // matters if a case explicitly exercises followers-only questions.
        return true;
      case 'lt':
        return String(columnValue(predicate.column, feedItem, question)) < String(predicate.value);
    }
  }

  function queryRows(predicate: Predicate | undefined, selection: unknown) {
    const matched = state.feedRows
      .map((feedItem) => ({ feedItem, question: state.questionRows.find((question) => question.id === feedItem.questionId) }))
      .filter(({ feedItem, question }) => Boolean(question) && evaluate(predicate, feedItem, question));

    if ((selection as { value?: unknown })?.value) return [{ value: matched.length }];
    return matched.map(({ feedItem }) => ({ item: feedItem }));
  }

  function makeThenable(rows: unknown[]) {
    return {
      orderBy: vi.fn(() => ({
        limit: vi.fn(async (limit: number) => rows.slice(0, limit)),
      })),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
  }

  const dbMock = {
    select: vi.fn((selection?: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate: Predicate | undefined) => makeThenable(predicate ? [] : [])),
        innerJoin: vi.fn(() => ({
          where: vi.fn((predicate: Predicate | undefined) => makeThenable(queryRows(predicate, selection))),
        })),
      })),
    })),
  };

  return { dbMock, state };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...predicates) => ({ op: 'and', predicates })),
  count: vi.fn(() => ({ expression: 'count' })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  lt: vi.fn((column, value) => ({ op: 'lt', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  notExists: vi.fn(() => ({ op: 'notExists' })),
  exists: vi.fn(() => ({ op: 'exists' })),
  notInArray: vi.fn((column, values) => ({ op: 'notInArray', column, values })),
  or: vi.fn((...predicates) => ({ op: 'or', predicates })),
  sql: Object.assign(
    vi.fn(() => ({ op: 'sql', as: (alias: string) => ({ op: 'sql', alias }) })),
    { raw: vi.fn((value: unknown) => ({ op: 'sql', value })) },
  ),
}));

vi.mock('@/server/db', () => ({
  db: dbMock,
  feedDismissedDomains: {
    userId: 'feedDismissedDomains.userId',
    canonicalSubcategory: 'feedDismissedDomains.canonicalSubcategory',
    reinstatedAt: 'feedDismissedDomains.reinstatedAt',
  },
  feedItems: {
    id: 'feedItems.id',
    recipientUserId: 'feedItems.recipientUserId',
    questionId: 'feedItems.questionId',
    sourceType: 'feedItems.sourceType',
    sourceUserId: 'feedItems.sourceUserId',
    sourceResult: 'feedItems.sourceResult',
    sourceEventAt: 'feedItems.sourceEventAt',
    state: 'feedItems.state',
    isPinned: 'feedItems.isPinned',
  },
  masteryEvents: {},
  follows: {
    followerId: 'follows.followerId',
    followeeId: 'follows.followeeId',
    state: 'follows.state',
  },
  questions: {
    id: 'questions.id',
    visibility: 'questions.visibility',
    deletedAt: 'questions.deletedAt',
    canonicalSubcategory: 'questions.canonicalSubcategory',
    creatorId: 'questions.creatorId',
  },
  users: { id: 'users.id', displayName: 'users.displayName' },
}));

vi.mock('@/server/db/pg-error', () => ({ pgErrorCode: vi.fn(() => null) }));

import { getFeedForUser } from '@/server/db/queries/feed';

describe('getFeedForUser feed visibility', () => {
  beforeEach(() => {
    state.feedRows = [];
    state.questionRows = [];
  });

  it('returns an active pinned direct_sent feed item', async () => {
    const sourceEventAt = new Date('2026-05-14T12:00:00.000Z');
    state.questionRows = [{ id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' }];
    state.feedRows = [{
      id: 'feed-direct-1',
      recipientUserId: 'recipient-1',
      questionId: 'question-1',
      sourceType: 'direct_sent',
      sourceUserId: 'sender-1',
      sourceResult: null,
      sourceEventAt,
      personalMessage: 'Try this one.',
      state: 'active',
      isPinned: true,
      joshingGameId: null,
    }];

    const result = await getFeedForUser('recipient-1');

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'feed-direct-1',
        sourceType: 'direct_sent',
        state: 'active',
        isPinned: true,
      }),
    ]);
    expect(result.totalCount).toBe(1);
  });

  it('hides answered items from the actionable inbox query', async () => {
    // The homepage feed is an inbox of things the viewer can still act on.
    // Once a feed item is in state='answered' the server stops returning it;
    // the client keeps the just-answered card in local React state for the
    // current page session and it disappears on the next load.
    const sourceEventAt = new Date('2026-05-14T12:00:00.000Z');
    state.questionRows = [{ id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' }];
    state.feedRows = [{
      id: 'feed-answered-1',
      recipientUserId: 'recipient-1',
      questionId: 'question-1',
      sourceType: 'direct_sent',
      sourceUserId: 'sender-1',
      sourceResult: null,
      sourceEventAt,
      personalMessage: 'Try this one.',
      state: 'answered',
      isPinned: true,
      joshingGameId: null,
    }];

    const result = await getFeedForUser('recipient-1');

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });


  it('excludes incorrect friend_answered items from the public social Feed', async () => {
    state.questionRows = [{ id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' }];
    state.feedRows = [{
      id: 'feed-friend-wrong',
      recipientUserId: 'recipient-1',
      questionId: 'question-1',
      sourceType: 'friend_answered',
      sourceUserId: 'friend-1',
      sourceResult: 'incorrect',
      sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
      personalMessage: null,
      state: 'active',
      isPinned: false,
      joshingGameId: null,
    }];

    const result = await getFeedForUser('recipient-1');

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('applies the sent-to-me URL filter', async () => {
    state.questionRows = [
      { id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
      { id: 'question-2', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
    ];
    state.feedRows = [
      {
        id: 'feed-direct-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-1',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        id: 'feed-friend-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-2',
        sourceType: 'friend_answered',
        sourceUserId: 'friend-1',
        sourceResult: 'correct',
        sourceEventAt: new Date('2026-05-14T12:01:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
    ];

    const result = await getFeedForUser('recipient-1', { filter: 'sent-to-me' });

    expect(result.items).toEqual([expect.objectContaining({ id: 'feed-direct-1' })]);
    expect(result.totalCount).toBe(1);
  });

  it('prioritizes unanswered direct-sent cards on the first page', async () => {
    state.questionRows = [
      { id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
      { id: 'question-2', visibility: 'public', deletedAt: null, canonicalSubcategory: 'History' },
    ];
    state.feedRows = [
      {
        id: 'feed-friend-newer',
        recipientUserId: 'recipient-1',
        questionId: 'question-2',
        sourceType: 'authored_shared',
        sourceUserId: 'friend-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T13:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        id: 'feed-direct-priority',
        recipientUserId: 'recipient-1',
        questionId: 'question-1',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: true,
        joshingGameId: null,
      },
    ];

    const result = await getFeedForUser('recipient-1', { limit: 1 });

    expect(result.items[0]).toEqual(expect.objectContaining({ id: 'feed-direct-priority' }));
  });

  it('excludes feed items for questions the viewer authored', async () => {
    state.questionRows = [
      // Viewer is the author — must be filtered out
      { id: 'question-own', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music', creatorId: 'recipient-1' },
      // Authored by someone else — should remain visible
      { id: 'question-friend', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music', creatorId: 'author-2' },
      // System-generated (no author) — should remain visible
      { id: 'question-system', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music', creatorId: null },
    ];
    state.feedRows = [
      {
        id: 'feed-self-authored',
        recipientUserId: 'recipient-1',
        questionId: 'question-own',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        id: 'feed-friend-authored',
        recipientUserId: 'recipient-1',
        questionId: 'question-friend',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:01:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        id: 'feed-system-authored',
        recipientUserId: 'recipient-1',
        questionId: 'question-system',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:02:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
    ];

    const result = await getFeedForUser('recipient-1');

    expect(result.items.map((item) => item.id).sort()).toEqual(['feed-friend-authored', 'feed-system-authored']);
    expect(result.totalCount).toBe(2);
  });

  it('applies the from-friends (Broadcasts) URL filter: authored_shared in, direct_sent and friend_answered out', async () => {
    state.questionRows = [
      { id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
      { id: 'question-2', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
      { id: 'question-3', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
    ];
    state.feedRows = [
      {
        id: 'feed-direct-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-1',
        sourceType: 'direct_sent',
        sourceUserId: 'sender-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        id: 'feed-authored-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-2',
        sourceType: 'authored_shared',
        sourceUserId: 'friend-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T12:01:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
      {
        // D-1 Stage 5: friend_answered is still written but no longer rendered.
        id: 'feed-friend-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-3',
        sourceType: 'friend_answered',
        sourceUserId: 'friend-2',
        sourceResult: 'correct',
        sourceEventAt: new Date('2026-05-14T12:02:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
    ];

    const result = await getFeedForUser('recipient-1', { filter: 'from-friends' });

    expect(result.items).toEqual([expect.objectContaining({ id: 'feed-authored-1' })]);
    expect(result.totalCount).toBe(1);
  });
});
