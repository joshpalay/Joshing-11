import { beforeEach, describe, expect, it, vi } from 'vitest';

// Behavioural test for `userHasQuestionInBlockingFeed`'s source-type scoping
// (the D-1 Stage 5 feed-flip fix): only a question pending in the recipient's
// RENDERED Feed inbox (direct_sent / authored_shared / legacy thumbs_upped)
// blocks a new send. An ambient `friend_answered` row must NOT block one.
//
// Self-contained because the shared feed.test.ts harness only evaluates the
// innerJoin().where() path, whereas this guard is a plain where().limit(1).

type Row = {
  id: string;
  recipientUserId: string;
  questionId: string;
  state: string;
  sourceType: string;
};

const { rows } = vi.hoisted(() => ({ rows: { current: [] as Row[] } }));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  or: (...parts: unknown[]) => ({ op: 'or', parts }),
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  ne: (col: string, val: unknown) => ({ op: 'ne', col, val }),
  inArray: (col: string, vals: readonly unknown[]) => ({ op: 'inArray', col, vals }),
  // Unused by this guard, but imported at feed.ts module scope.
  count: () => ({}),
  desc: () => ({}),
  exists: () => ({}),
  isNull: () => ({}),
  lt: () => ({}),
  notExists: () => ({}),
  notInArray: () => ({}),
  sql: Object.assign(() => ({ as: () => ({}) }), { raw: () => ({ as: () => ({}) }) }),
}));

vi.mock('@/server/db', () => {
  const colVal = (col: string, row: Row) => (row as unknown as Record<string, unknown>)[col];
  const evalPred = (p: { op: string; [k: string]: unknown }, row: Row): boolean => {
    if (!p) return true;
    switch (p.op) {
      case 'and':
        return (p.parts as Array<typeof p>).every((x) => evalPred(x, row));
      case 'or':
        return (p.parts as Array<typeof p>).some((x) => evalPred(x, row));
      case 'eq':
        return colVal(p.col as string, row) === p.val;
      case 'ne':
        return colVal(p.col as string, row) !== p.val;
      case 'inArray':
        return (p.vals as readonly unknown[]).includes(colVal(p.col as string, row));
      default:
        return true;
    }
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (pred: { op: string; [k: string]: unknown }) => ({
            limit: async (n: number) =>
              rows.current.filter((r) => evalPred(pred, r)).slice(0, n).map((r) => ({ id: r.id })),
          }),
        }),
      }),
    },
    feedItems: {
      id: 'id',
      recipientUserId: 'recipientUserId',
      questionId: 'questionId',
      state: 'state',
      sourceType: 'sourceType',
    },
    feedDismissedDomains: {},
    follows: {},
    masteryEvents: {},
    questions: {},
    users: {},
  };
});

vi.mock('@/server/db/pg-error', () => ({ pgErrorCode: () => null, pgErrorMessage: () => '' }));

import { userHasQuestionInBlockingFeed } from '@/server/db/queries/feed';

function row(partial: Partial<Row>): Row {
  return {
    id: 'f1',
    recipientUserId: 'recipient-1',
    questionId: 'q-1',
    state: 'active',
    sourceType: 'direct_sent',
    ...partial,
  };
}

beforeEach(() => {
  rows.current = [];
});

describe('userHasQuestionInBlockingFeed source-type scoping', () => {
  it('does NOT block on an ambient friend_answered row (post feed-flip)', async () => {
    rows.current = [row({ sourceType: 'friend_answered' })];
    expect(await userHasQuestionInBlockingFeed('recipient-1', 'q-1')).toBe(false);
  });

  it('blocks on a pending direct_sent row', async () => {
    rows.current = [row({ sourceType: 'direct_sent' })];
    expect(await userHasQuestionInBlockingFeed('recipient-1', 'q-1')).toBe(true);
  });

  it('blocks on a pending authored_shared (broadcast) row', async () => {
    rows.current = [row({ sourceType: 'authored_shared' })];
    expect(await userHasQuestionInBlockingFeed('recipient-1', 'q-1')).toBe(true);
  });

  it('does not block when the only inbox row is for a different recipient or question', async () => {
    rows.current = [
      row({ recipientUserId: 'someone-else', sourceType: 'direct_sent' }),
      row({ questionId: 'q-other', sourceType: 'direct_sent' }),
    ];
    expect(await userHasQuestionInBlockingFeed('recipient-1', 'q-1')).toBe(false);
  });

  it('does not block on a rolled-off send (non-blocking state)', async () => {
    rows.current = [row({ sourceType: 'direct_sent', state: 'rolled_off' })];
    expect(await userHasQuestionInBlockingFeed('recipient-1', 'q-1')).toBe(false);
  });
});
