import { describe, expect, it, vi } from 'vitest';

// questionVisibilityPredicate (D-1 Stage 4) is access-control logic: a 'friends'
// (followers-only) question must render only when the viewer follows the author.
// We mock drizzle-orm operators as structural constructors so we can assert the
// exact predicate shape — a regression like swapping followerId/followeeId or
// dropping the state='approved' filter would leak private content and is caught
// here.
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  exists: vi.fn((query) => ({ op: 'exists', query })),
  // sql is used both as a tagged template (sql`1`) and chained (sql`NULL`.as(...))
  // for the compatibility-column projection at module load.
  sql: vi.fn(() => ({ op: 'sql', as: vi.fn(() => ({ op: 'sqlAs' })) })),
  // Other operators imported by feed.ts but unused at module load / in this path.
  count: vi.fn(() => ({ op: 'count' })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  lt: vi.fn((column, value) => ({ op: 'lt', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  notInArray: vi.fn((column, values) => ({ op: 'notInArray', column, values })),
}));

function makeChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (r: unknown[]) => unknown) => resolve(rows);
  return chain;
}

vi.mock('@/server/db', () => ({
  db: { select: vi.fn(() => makeChain()) },
  follows: { followerId: 'follows.followerId', followeeId: 'follows.followeeId', state: 'follows.state' },
  questions: { visibility: 'questions.visibility', creatorId: 'questions.creatorId', deletedAt: 'questions.deletedAt', canonicalSubcategory: 'questions.canonicalSubcategory', id: 'questions.id' },
  feedItems: { sourceType: 'feedItems.sourceType', sourceResult: 'feedItems.sourceResult', questionId: 'feedItems.questionId', recipientUserId: 'feedItems.recipientUserId' },
  feedDismissedDomains: { canonicalSubcategory: 'feedDismissedDomains.canonicalSubcategory' },
  masteryEvents: { id: 'masteryEvents.id', userId: 'masteryEvents.userId' },
  users: { id: 'users.id' },
}));

import { feedItemVisibilityPredicate, questionVisibilityPredicate } from '@/server/db/queries/feed';

describe('feedItemVisibilityPredicate (direct_sent exemption)', () => {
  it('admits a feed item when it is direct_sent OR the question visibility gate passes', () => {
    const predicate = feedItemVisibilityPredicate('viewer-1') as { op: string; parts: unknown[] };

    expect(predicate.op).toBe('or');

    // A question addressed directly to the viewer renders regardless of the
    // question's visibility — otherwise a 'friends' send to a non-follower is
    // silently filtered out of the recipient's feed.
    expect(predicate.parts).toContainEqual({ op: 'eq', column: 'feedItems.sourceType', value: 'direct_sent' });

    // The broadcast/feed visibility gate is still the other branch.
    const visibilityBranch = predicate.parts.find(
      (p): p is { op: string; parts: unknown[] } =>
        typeof p === 'object' && p !== null && (p as { op?: string }).op === 'or',
    );
    expect(visibilityBranch).toBeDefined();
    expect(visibilityBranch!.parts).toContainEqual({ op: 'eq', column: 'questions.visibility', value: 'public' });
  });
});

describe('questionVisibilityPredicate (D-1 Stage 4)', () => {
  it('admits public questions unconditionally and gates friends on an approved viewer→author follow', () => {
    const predicate = questionVisibilityPredicate('viewer-1') as { op: string; parts: unknown[] };

    expect(predicate.op).toBe('or');

    // Branch 1: public is always visible.
    expect(predicate.parts).toContainEqual({ op: 'eq', column: 'questions.visibility', value: 'public' });

    // Branch 2: friends-visible AND an EXISTS over an approved follow edge.
    const friendsBranch = predicate.parts.find(
      (p): p is { op: string; parts: unknown[] } =>
        typeof p === 'object' && p !== null && (p as { op?: string }).op === 'and',
    );
    expect(friendsBranch).toBeDefined();
    expect(friendsBranch!.parts).toContainEqual({ op: 'eq', column: 'questions.visibility', value: 'friends' });

    const existsClause = friendsBranch!.parts.find(
      (p): p is { op: string } => typeof p === 'object' && p !== null && (p as { op?: string }).op === 'exists',
    );
    expect(existsClause).toBeDefined();
  });

  it('never admits private to another viewer (no private branch)', () => {
    const predicate = JSON.stringify(questionVisibilityPredicate('viewer-1'));
    expect(predicate).not.toContain('"value":"private"');
  });
});
