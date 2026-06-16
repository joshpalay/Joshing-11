import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// The visibility='blocked' leak fix funnels every authored read path through a
// single shared predicate (notBlocked / notBlockedForViewer) plus a pure JS
// mirror (isBlockedForViewer). Mirrors question-visibility.test.ts, but instead
// of only asserting predicate SHAPE we mock the drizzle operators as EVALUABLE
// nodes — each carries a .test(row) — so we can assert the actual
// included/excluded BEHAVIOR the four-point matrix calls for:
//   1. blocked + non-owner viewer  → EXCLUDED
//   2. blocked + owner (creator===viewer) → INCLUDED (the "this was removed" view)
//   3. (generated → blocked-generated.test.ts; no owner case)
//   4. public question → unaffected
type Row = { visibility: string; creatorId: string | null };
type Node = { op: string; test: (row: Row) => boolean };

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: keyof Row, value: unknown) => ({
    op: 'eq',
    test: (row: Row) => row[column] === value,
  })),
  ne: vi.fn((column: keyof Row, value: unknown) => ({
    op: 'ne',
    test: (row: Row) => row[column] !== value,
  })),
  or: vi.fn((...parts: Node[]) => ({
    op: 'or',
    test: (row: Row) => parts.some((p) => p.test(row)),
  })),
}));

// Columns keyed to the fixture row's own field names, so a predicate built over
// `questions.visibility` evaluates `row.visibility`.
vi.mock('@/server/db', () => ({
  questions: {
    visibility: 'visibility',
    creatorId: 'creatorId',
    id: 'id',
    source: 'source',
    deletedAt: 'deletedAt',
    canonicalSubcategory: 'canonicalSubcategory',
    broadCategory: 'broadCategory',
    category: 'category',
  },
  feedItems: { sourceType: 'sourceType' },
}));

import {
  isBlockedForViewer,
  notBlocked,
  notBlockedForViewer,
} from '@/server/feed/visibility';

const OWNER = 'author-1';
const OTHER = 'viewer-2';

const blockedByOwner: Row = { visibility: 'blocked', creatorId: OWNER };
const publicByOwner: Row = { visibility: 'public', creatorId: OWNER };

describe('notBlockedForViewer (owner-aware history/own-content predicate)', () => {
  it('1. EXCLUDES a blocked question for a non-owner viewer', () => {
    const pred = notBlockedForViewer(OTHER) as unknown as Node;
    expect(pred.test(blockedByOwner)).toBe(false);
  });

  it('2. INCLUDES the same blocked question for its owner (creatorId === viewerId)', () => {
    const pred = notBlockedForViewer(OWNER) as unknown as Node;
    expect(pred.test(blockedByOwner)).toBe(true);
  });

  it('4. leaves a normal public question visible to everyone', () => {
    expect((notBlockedForViewer(OTHER) as unknown as Node).test(publicByOwner)).toBe(true);
    expect((notBlockedForViewer(OWNER) as unknown as Node).test(publicByOwner)).toBe(true);
  });

  it('reduces to a pure blocked check when the viewer is not the creator (safe on friend-only surfaces)', () => {
    // On milestones / from-friends the row is never viewer-authored, so the
    // owner clause never fires and the predicate behaves exactly like notBlocked().
    const pred = notBlockedForViewer(OTHER) as unknown as Node;
    expect(pred.test({ visibility: 'blocked', creatorId: 'someone-else' })).toBe(false);
    expect(pred.test({ visibility: 'public', creatorId: 'someone-else' })).toBe(true);
  });
});

describe('notBlocked (bare broadcast/feed predicate — NO owner exception)', () => {
  it('EXCLUDES a blocked question even from its own author', () => {
    // The feed is a broadcast surface: a blocked question must never resurface
    // for anyone, including the author. This is why feed keeps the bare form.
    expect((notBlocked() as unknown as Node).test(blockedByOwner)).toBe(false);
  });

  it('leaves a public question visible', () => {
    expect((notBlocked() as unknown as Node).test(publicByOwner)).toBe(true);
  });
});

describe('isBlockedForViewer (JS mirror, for the archive daily slot-snapshot path)', () => {
  it('1. reports a blocked question as blocked for a non-owner viewer', () => {
    expect(isBlockedForViewer({ visibility: 'blocked', creatorId: OWNER }, OTHER)).toBe(true);
  });

  it('2. does NOT block the owner from their own blocked question', () => {
    expect(isBlockedForViewer({ visibility: 'blocked', creatorId: OWNER }, OWNER)).toBe(false);
  });

  it('4. never blocks a public question', () => {
    expect(isBlockedForViewer({ visibility: 'public', creatorId: OWNER }, OTHER)).toBe(false);
  });
});
