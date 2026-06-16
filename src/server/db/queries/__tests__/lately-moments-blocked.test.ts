import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-surface wiring test for Lately moments — one of the two VERIFIED leak
// surfaces. We mock drizzle as EVALUABLE operators, run getLatelyMoments, capture
// the real WHERE it builds (which includes the live notBlockedForViewer call),
// extract the blocked node and assert the four-point matrix on THIS surface:
//   1. blocked + non-owner → EXCLUDED   2. blocked + owner → INCLUDED   4. public → unaffected.
type Row = { visibility: string; creatorId: string | null };
interface Node {
  op: string;
  column?: unknown;
  value?: unknown;
  parts?: Node[];
  query?: Node;
  test?: (row: Row) => boolean;
}

let capturedWhere: Node | null = null;

vi.mock('drizzle-orm', () => {
  const evaluable = {
    eq: vi.fn((column, value) => ({ op: 'eq', column, value, test: (r: Row) => (r as Record<string, unknown>)[column as string] === value })),
    ne: vi.fn((column, value) => ({ op: 'ne', column, value, test: (r: Row) => (r as Record<string, unknown>)[column as string] !== value })),
    or: vi.fn((...parts: Node[]) => ({ op: 'or', parts, test: (r: Row) => parts.some((p) => typeof p.test === 'function' && p.test(r)) })),
    and: vi.fn((...parts: Node[]) => ({ op: 'and', parts, test: (r: Row) => parts.every((p) => (typeof p.test === 'function' ? p.test(r) : true)) })),
  };
  return {
    ...evaluable,
    desc: vi.fn((column) => ({ op: 'desc', column })),
    gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
    inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
    isNotNull: vi.fn((column) => ({ op: 'isNotNull', column })),
    isNull: vi.fn((column) => ({ op: 'isNull', column })),
    sql: vi.fn(() => ({ op: 'sql', as: vi.fn(() => ({ op: 'sqlAs' })) })),
  };
});

vi.mock('@/server/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'orderBy']) chain[m] = vi.fn(() => chain);
  chain.where = vi.fn((cond: Node) => {
    capturedWhere = cond;
    return chain;
  });
  chain.limit = vi.fn(() => Promise.resolve([]));
  return {
    db: { select: vi.fn(() => chain) },
    feedItems: { sourceUserId: 'sourceUserId', recipientUserId: 'recipientUserId', sourceType: 'sourceType', sourceResult: 'sourceResult', questionId: 'questionId', sourceEventAt: 'sourceEventAt', sourceAnswerId: 'sourceAnswerId', joshingGameId: 'joshingGameId' },
    follows: { followeeId: 'followeeId', followerId: 'followerId', state: 'state' },
    masteryEvents: { id: 'meId', userId: 'meUserId', sourceType: 'meSourceType', answerState: 'meAnswerState', questionId: 'meQuestionId', createdAt: 'meCreatedAt', answeredByUserId: 'meAnsweredBy' },
    questions: { id: 'id', creatorId: 'creatorId', questionText: 'questionText', canonicalSubcategory: 'canonicalSubcategory', broadCategory: 'broadCategory', category: 'category', visibility: 'visibility', source: 'source', trustTier: 'trustTier' },
    users: { id: 'usersId', displayName: 'displayName' },
  };
});

import { getLatelyMoments } from '@/server/db/queries/lately';

// Find the owner-aware blocked node: an `or` whose parts include `ne visibility blocked`.
function findBlockedOr(node: Node | null): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (
    node.op === 'or' &&
    (node.parts ?? []).some((p) => p.op === 'ne' && p.column === 'visibility' && p.value === 'blocked')
  ) {
    return node;
  }
  for (const child of [...(node.parts ?? []), node.query]) {
    const found = findBlockedOr(child ?? null);
    if (found) return found;
  }
  return undefined;
}

const VIEWER = 'viewer-2';

beforeEach(() => {
  capturedWhere = null;
});
afterEach(() => vi.clearAllMocks());

describe('getLatelyMoments wires in the visibility=blocked hard-block', () => {
  it('includes an owner-aware notBlockedForViewer predicate in its WHERE', async () => {
    await getLatelyMoments(VIEWER);
    const blocked = findBlockedOr(capturedWhere);
    expect(blocked).toBeDefined();
  });

  it('1. EXCLUDES a blocked question authored by someone else', async () => {
    await getLatelyMoments(VIEWER);
    const blocked = findBlockedOr(capturedWhere)!;
    expect(blocked.test!({ visibility: 'blocked', creatorId: 'author-1' })).toBe(false);
  });

  it('2. INCLUDES a blocked question the VIEWER authored (they_got_you owner case)', async () => {
    await getLatelyMoments(VIEWER);
    const blocked = findBlockedOr(capturedWhere)!;
    expect(blocked.test!({ visibility: 'blocked', creatorId: VIEWER })).toBe(true);
  });

  it('4. leaves a normal public question visible', async () => {
    await getLatelyMoments(VIEWER);
    const blocked = findBlockedOr(capturedWhere)!;
    expect(blocked.test!({ visibility: 'public', creatorId: 'author-1' })).toBe(true);
  });
});
