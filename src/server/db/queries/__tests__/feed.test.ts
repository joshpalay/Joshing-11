import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, state } = vi.hoisted(() => {
  type Predicate =
    | { op: 'eq'; column: string; value: unknown }
    | { op: 'and'; predicates: Array<Predicate | undefined> }
    | { op: 'or'; predicates: Array<Predicate | undefined> }
    | { op: 'inArray'; column: string; values: readonly unknown[] }
    | { op: 'isNull'; column: string }
    | { op: 'notInArray'; column: string; values: readonly unknown[] }
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
    submittedAnswer?: string | null;
    quip?: string | null;
  };

  type QuestionRow = {
    id: string;
    visibility: string;
    deletedAt: Date | null;
    canonicalSubcategory: string | null;
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
  notInArray: vi.fn((column, values) => ({ op: 'notInArray', column, values })),
  or: vi.fn((...predicates) => ({ op: 'or', predicates })),
  sql: vi.fn(() => ({ op: 'sql' })),
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
  questions: {
    id: 'questions.id',
    visibility: 'questions.visibility',
    deletedAt: 'questions.deletedAt',
    canonicalSubcategory: 'questions.canonicalSubcategory',
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

  it('keeps answered direct_sent items visible even if they were pinned before answer', async () => {
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
      submittedAnswer: 'wrong guess',
      quip: 'Not quite.',
    }];

    const result = await getFeedForUser('recipient-1');

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'feed-answered-1',
        sourceType: 'direct_sent',
        state: 'answered',
        isPinned: true,
      }),
    ]);
    expect(result.totalCount).toBe(1);
  });

  it('filters out incorrect public friend_answered items', async () => {
    state.questionRows = [{ id: 'question-1', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' }];
    state.feedRows = [{
      id: 'feed-wrong-friend-1',
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

  it('applies the sent-to-me Feed filter', async () => {
    state.questionRows = [
      { id: 'question-direct', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
      { id: 'question-friend', visibility: 'public', deletedAt: null, canonicalSubcategory: 'Music' },
    ];
    state.feedRows = [
      {
        id: 'feed-direct-1',
        recipientUserId: 'recipient-1',
        questionId: 'question-direct',
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
        questionId: 'question-friend',
        sourceType: 'authored_shared',
        sourceUserId: 'friend-1',
        sourceResult: null,
        sourceEventAt: new Date('2026-05-14T11:00:00.000Z'),
        personalMessage: null,
        state: 'active',
        isPinned: false,
        joshingGameId: null,
      },
    ];

    const result = await getFeedForUser('recipient-1', { filter: 'sent-to-me' });

    expect(result.items.map((item) => item.id)).toEqual(['feed-direct-1']);
    expect(result.totalCount).toBe(1);
  });
});
