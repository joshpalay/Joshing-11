import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D-REVIEW-RECOVERED-01 — wiring tests for the recovered-questions readers and
// the set-aside mutations.
//
// The drizzle layer is mocked as inert builders that record the WHERE / ORDER BY
// and resolve to canned rows. We assert:
//   - the pool definition (answer_state = first_correct_after_wrong +
//     question_id IS NOT NULL, optional `since` lower bound, shuffled — no SQL
//     ORDER BY);
//   - set-aside questions carry the flag and sort to the bottom;
//   - the set-aside / restore mutations issue the expected insert / update.
interface Node {
  op: string;
  column?: unknown;
  value?: unknown;
  values?: unknown;
  parts?: Node[];
}

let capturedWheres: Node[] = [];
let capturedOrderBy: Node | null = null;
let selectCalls = 0;
let selectQueue: unknown[][] = [];
let insertCalls = 0;
let insertValues: unknown = null;
let updateCalls = 0;
let updateSet: unknown = null;
let deleteCalls = 0;

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts: Node[]) => ({ op: 'and', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  isNotNull: vi.fn((column) => ({ op: 'isNotNull', column })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
}));

function builder(resolved: unknown) {
  const node: Record<string, unknown> = {};
  const passthrough = (capture?: (arg: unknown) => void) =>
    vi.fn((arg: unknown) => {
      capture?.(arg);
      return node;
    });
  node.from = passthrough();
  node.innerJoin = passthrough();
  node.leftJoin = passthrough();
  node.where = passthrough((cond) => capturedWheres.push(cond as Node));
  node.orderBy = passthrough((order) => {
    capturedOrderBy = order as Node;
  });
  node.limit = passthrough();
  node.values = passthrough((v) => {
    insertValues = v;
  });
  node.set = passthrough((v) => {
    updateSet = v;
  });
  // Thenable so `await` at any terminal (.where / .orderBy / .limit / .values …)
  // resolves to this call's canned rows.
  node.then = (onFulfilled: (value: unknown) => unknown) => onFulfilled(resolved);
  return node;
}

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCalls += 1;
      return builder(selectQueue.length ? selectQueue.shift() : []);
    }),
    insert: vi.fn(() => {
      insertCalls += 1;
      return builder(undefined);
    }),
    update: vi.fn(() => {
      updateCalls += 1;
      return builder(undefined);
    }),
    delete: vi.fn(() => {
      deleteCalls += 1;
      return builder(undefined);
    }),
  },
  masteryEvents: {
    id: 'me.id',
    userId: 'me.userId',
    sourceType: 'me.sourceType',
    answerState: 'me.answerState',
    questionId: 'me.questionId',
    createdAt: 'me.createdAt',
  },
  questions: {
    id: 'q.id',
    questionText: 'q.questionText',
    answerText: 'q.answerText',
    canonicalSubcategory: 'q.canonicalSubcategory',
    category: 'q.category',
    explainerFull: 'q.explainerFull',
    explainerBrief: 'q.explainerBrief',
    factualExplanation: 'q.factualExplanation',
    creatorNote: 'q.creatorNote',
  },
  recoveredSetAside: {
    id: 'rsa.id',
    userId: 'rsa.userId',
    questionId: 'rsa.questionId',
    reinstatedAt: 'rsa.reinstatedAt',
  },
}));

import {
  getRecoveredQuestionsForUser,
  restoreRecoveredQuestion,
  setAsideRecoveredQuestion,
} from '@/server/db/queries/recovered-questions';

function flatten(node: Node | null): Node[] {
  if (!node) return [];
  if (node.op === 'and') return (node.parts ?? []).flatMap(flatten);
  return [node];
}

function allWhereNodes(): Node[] {
  return capturedWheres.flatMap(flatten);
}

const VIEWER = 'viewer-1';

function poolRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'me-1',
    questionId: 'q-1',
    questionText: 'Who wrote the Storia d’Italia?',
    canonicalSubcategory: 'history',
    category: 'general_knowledge',
    recoveredAt: new Date('2026-06-01T00:00:00Z'),
    answerText: 'Francesco Guicciardini',
    explainerFull: 'Full explainer.',
    explainerBrief: 'Brief.',
    factualExplanation: 'Fact.',
    creatorNote: null,
    ...over,
  };
}

beforeEach(() => {
  capturedWheres = [];
  capturedOrderBy = null;
  selectCalls = 0;
  selectQueue = [];
  insertCalls = 0;
  insertValues = null;
  updateCalls = 0;
  updateSet = null;
  deleteCalls = 0;
});
afterEach(() => vi.clearAllMocks());

describe('getRecoveredQuestionsForUser — pool definition', () => {
  it('filters on answer_state = first_correct_after_wrong', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = allWhereNodes().find((n) => n.op === 'eq' && n.column === 'me.answerState');
    expect(match).toBeDefined();
    expect(match!.value).toBe('first_correct_after_wrong');
  });

  it('guards question_id IS NOT NULL', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = allWhereNodes().find((n) => n.op === 'isNotNull' && n.column === 'me.questionId');
    expect(match).toBeDefined();
  });

  it('scopes to the viewer', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    const match = allWhereNodes().find((n) => n.op === 'eq' && n.column === 'me.userId');
    expect(match).toBeDefined();
    expect(match!.value).toBe(VIEWER);
  });

  it('applies no SQL ORDER BY (ordering is a server-side shuffle, Decision C revised)', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    expect(capturedOrderBy).toBeNull();
  });

  it('adds a created_at lower bound when `withinDays` is given', async () => {
    const before = Date.now();
    await getRecoveredQuestionsForUser(VIEWER, { withinDays: 30 });
    const after = Date.now();
    const match = allWhereNodes().find((n) => n.op === 'gte' && n.column === 'me.createdAt');
    expect(match).toBeDefined();
    const cutoff = (match!.value as Date).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - thirtyDaysMs);
    expect(cutoff).toBeLessThanOrEqual(after - thirtyDaysMs);
  });

  it('applies no created_at bound when `withinDays` is null or omitted', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    await getRecoveredQuestionsForUser(VIEWER, { withinDays: null });
    expect(allWhereNodes().find((n) => n.op === 'gte')).toBeUndefined();
  });

  it('issues no insert/update/delete on the read path', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    expect(insertCalls).toBe(0);
    expect(updateCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });
});

describe('getRecoveredQuestionsForUser — set-aside flag and ordering', () => {
  it('maps the answer/explainer fields for the reveal', async () => {
    selectQueue = [[poolRow()], []]; // pool rows, then active set-aside ids
    const [row] = await getRecoveredQuestionsForUser(VIEWER);
    expect(row.answer).toBe('Francesco Guicciardini');
    expect(row.explanation).toBe('Full explainer.');
    expect(row.creatorNote).toBeNull();
    expect(row.setAside).toBe(false);
  });

  it('flags set-aside questions and demotes them to the bottom', async () => {
    selectQueue = [
      [
        poolRow({ id: 'me-a', questionId: 'q-a' }),
        poolRow({ id: 'me-b', questionId: 'q-b' }), // this one is set aside
        poolRow({ id: 'me-c', questionId: 'q-c' }),
      ],
      [{ questionId: 'q-b' }], // active set-aside ids
    ];
    const result = await getRecoveredQuestionsForUser(VIEWER);
    // The shuffle makes within-group order nondeterministic, so assert the
    // partition: the set-aside question is last, the others precede it.
    expect(result.map((q) => q.questionId).sort()).toEqual(['q-a', 'q-b', 'q-c']);
    expect(result[result.length - 1].questionId).toBe('q-b');
    expect(result.find((q) => q.questionId === 'q-b')!.setAside).toBe(true);
    expect(result.find((q) => q.questionId === 'q-a')!.setAside).toBe(false);
  });

  it('shuffles the pool (order follows Math.random, not row order)', async () => {
    selectQueue = [
      [
        poolRow({ id: 'me-a', questionId: 'q-a' }),
        poolRow({ id: 'me-b', questionId: 'q-b' }),
        poolRow({ id: 'me-c', questionId: 'q-c' }),
      ],
      [],
    ];
    // Fisher–Yates with random() = 0 swaps each element to the front:
    // [a,b,c] → i=2 swaps a/c → [c,b,a] → i=1 swaps c→? j=0 swaps b/c → [b,c,a].
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await getRecoveredQuestionsForUser(VIEWER);
      expect(result.map((q) => q.questionId)).toEqual(['q-b', 'q-c', 'q-a']);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('setAsideRecoveredQuestion', () => {
  it('inserts an active row when none exists', async () => {
    selectQueue = [[]]; // existing-active check returns nothing
    await setAsideRecoveredQuestion(VIEWER, 'q-7');
    expect(insertCalls).toBe(1);
    expect(insertValues).toEqual({ userId: VIEWER, questionId: 'q-7' });
  });

  it('is a no-op when already set aside', async () => {
    selectQueue = [[{ id: 'rsa-1' }]]; // an active row already exists
    await setAsideRecoveredQuestion(VIEWER, 'q-7');
    expect(insertCalls).toBe(0);
  });
});

describe('restoreRecoveredQuestion', () => {
  it('marks the active row reinstated for the viewer + question', async () => {
    await restoreRecoveredQuestion(VIEWER, 'q-7');
    expect(updateCalls).toBe(1);
    expect((updateSet as { reinstatedAt: Date }).reinstatedAt).toBeInstanceOf(Date);
    const flat = allWhereNodes();
    expect(flat.find((n) => n.op === 'eq' && n.column === 'rsa.userId')?.value).toBe(VIEWER);
    expect(flat.find((n) => n.op === 'eq' && n.column === 'rsa.questionId')?.value).toBe('q-7');
    expect(flat.find((n) => n.op === 'isNull' && n.column === 'rsa.reinstatedAt')).toBeDefined();
  });
});
