import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-surface wiring test for daily catch-up — the second VERIFIED leak surface.
// We drive getCatchupQuestions with eligible queue slots (one canonical, one
// generated), capture each query's WHERE keyed by the table it selects FROM, and
// assert the real predicates wired in:
//   - canonical (authored) query carries a bare notBlocked() ne-visibility-blocked
//   - generated query carries the notExists upheld-inappropriate terminal block.
type Row = { visibility: string; creatorId: string | null };
interface Node {
  op: string;
  column?: unknown;
  value?: unknown;
  parts?: Node[];
  query?: Node;
  test?: (row: Row) => boolean;
}

// Hoisted so the (hoisted) vi.mock factories below can reference them.
const { TABLES, captures, rowsByTable } = vi.hoisted(() => ({
  TABLES: {
    dailyQueues: { id: 'dq.id', userId: 'dq.userId', queueDate: 'dq.queueDate' },
    questions: { id: 'q.id', visibility: 'visibility', creatorId: 'creatorId', deletedAt: 'deletedAt' },
    generatedQuestions: { id: 'gq.id', userId: 'gq.userId' },
    feedItems: { id: 'fi.id', recipientUserId: 'fi.recip', state: 'fi.state', answerResult: 'fi.res', catchupResolvedAt: 'fi.resolved', sourceEventAt: 'fi.evt', questionId: 'fi.q' },
    contentReports: { questionId: 'cr.q', generatedQuestionId: 'cr.gq', category: 'cr.category', status: 'cr.status' },
    users: { id: 'u.id', displayName: 'u.name' },
  },
  captures: [] as Array<{ from: unknown; where: Node }>,
  rowsByTable: new Map<unknown, unknown[]>(),
}));

vi.mock('drizzle-orm', () => {
  const evaluable = {
    eq: vi.fn((column, value) => ({ op: 'eq', column, value, test: (r: Row) => (r as Record<string, unknown>)[column as string] === value })),
    ne: vi.fn((column, value) => ({ op: 'ne', column, value, test: (r: Row) => (r as Record<string, unknown>)[column as string] !== value })),
    or: vi.fn((...parts: Node[]) => ({ op: 'or', parts, test: (r: Row) => parts.some((p) => typeof p.test === 'function' && p.test(r)) })),
    and: vi.fn((...parts: Node[]) => ({ op: 'and', parts, test: (r: Row) => parts.every((p) => (typeof p.test === 'function' ? p.test(r) : true)) })),
  };
  return {
    ...evaluable,
    asc: vi.fn((column) => ({ op: 'asc', column })),
    desc: vi.fn((column) => ({ op: 'desc', column })),
    gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
    lte: vi.fn((column, value) => ({ op: 'lte', column, value })),
    inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
    isNotNull: vi.fn((column) => ({ op: 'isNotNull', column })),
    isNull: vi.fn((column) => ({ op: 'isNull', column })),
    notExists: vi.fn((query) => ({ op: 'notExists', query })),
    sql: vi.fn(() => ({ op: 'sql', as: vi.fn(() => ({ op: 'sqlAs' })) })),
  };
});

vi.mock('@/server/db', () => {
  const rowsFor = (table: unknown) => (rowsByTable.get(table) ?? []) as unknown[];
  const makeChain = () => {
    let fromTable: unknown = null;
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn((t: unknown) => {
        fromTable = t;
        return chain;
      }),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(rowsFor(fromTable))),
      where: vi.fn((cond: Node) => {
        captures.push({ from: fromTable, where: cond });
        return chain;
      }),
      then: (resolve: (r: unknown[]) => unknown) => resolve(rowsFor(fromTable)),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeChain()) },
    dailyQueues: TABLES.dailyQueues,
    questions: TABLES.questions,
    generatedQuestions: TABLES.generatedQuestions,
    feedItems: TABLES.feedItems,
    contentReports: TABLES.contentReports,
    users: TABLES.users,
    // tables imported by daily.ts but unused on the catch-up read path
    dailyPreferences: {}, declaredInterests: {}, masteryEvents: {}, playerMastery: {},
    skippedDailyQuestions: {}, userDomainExclusions: {},
  };
});

vi.mock('@/lib/games/timezone', () => ({
  getDailyAssignmentBounds: () => ({ assignmentDateStr: '2026-06-16', assignmentDate: new Date('2026-06-16T00:00:00Z') }),
}));
vi.mock('@/server/play/catch-up-eligibility', () => ({
  isCatchUpQueueDateEligible: () => true,
  isCatchUpSlotEligible: () => true,
  catchUpExpiresAt: () => '2026-07-01',
  expiresWithin24Hours: () => false,
  queueAgeInDays: () => 0,
}));
vi.mock('@/server/daily/catchup', () => ({
  CATCHUP_LOOKBACK_DAYS: 30,
  asQueueSlots: (v: unknown) => (Array.isArray(v) ? v : []),
  dailyQueueItemId: () => 'item-id',
  feedCatchupItemId: () => 'feed-item-id',
  minusUtcDays: () => new Date('2026-06-01T00:00:00Z'),
}));

import { getCatchupQuestions } from '@/server/db/queries/daily';

function findNe(node: Node | null | undefined, column: string, value: unknown): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (node.op === 'ne' && node.column === column && node.value === value) return node;
  for (const child of [...(node.parts ?? []), node.query]) {
    const found = findNe(child, column, value);
    if (found) return found;
  }
  return undefined;
}
function findOp(node: Node | null | undefined, op: string): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (node.op === op) return node;
  for (const child of [...(node.parts ?? []), node.query]) {
    const found = findOp(child, op);
    if (found) return found;
  }
  return undefined;
}

beforeEach(() => {
  captures.length = 0;
  rowsByTable.clear();
  // One queue with an eligible canonical slot and an eligible generated slot.
  rowsByTable.set(TABLES.dailyQueues, [
    {
      id: 'queue-1',
      queueDate: '2026-06-10',
      slots: [
        { slot_index: 0, question_id: 'cq-1', answered: true },
        { slot_index: 1, generated_question_id: 'gq-1', answered: true },
      ],
    },
  ]);
});
afterEach(() => vi.clearAllMocks());

describe('getCatchupQuestions wires the hard-block into the daily canonical + generated reads', () => {
  it('canonical (authored) query EXCLUDES blocked and leaves public unaffected (bare notBlocked)', async () => {
    await getCatchupQuestions('viewer-2');
    const canonical = captures.filter((c) => c.from === TABLES.questions);
    expect(canonical.length).toBeGreaterThan(0);

    const ne = findNe(canonical[0].where, 'visibility', 'blocked');
    expect(ne).toBeDefined();
    expect(ne!.test!({ visibility: 'blocked', creatorId: 'anyone' })).toBe(false); // 1. excluded
    expect(ne!.test!({ visibility: 'public', creatorId: 'anyone' })).toBe(true); // 4. unaffected
  });

  it('generated query carries the upheld-inappropriate notExists terminal block', async () => {
    await getCatchupQuestions('viewer-2');
    const generated = captures.find((c) => c.from === TABLES.generatedQuestions);
    expect(generated).toBeDefined();
    expect(findOp(generated!.where, 'notExists')).toBeDefined(); // 3. generated terminal block
  });
});
