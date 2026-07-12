import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D-REVIEW-RECOVERED-01 — wiring tests for the recovered-questions readers and
// the set-aside mutations.
//
// The drizzle layer is mocked as inert builders that record the WHERE / ORDER BY
// and resolve to canned rows. We assert:
//   - the pool definition (answer_state = first_correct_after_wrong +
//     question_id IS NOT NULL, ordered created_at DESC for the dismissed
//     shelf);
//   - the deck/dismissed split: dismissed questions leave circulation, the
//     `withinDays` bound applies to the deck only, and the deck is shuffled;
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
let selectQueue: unknown[][] = [];
let insertCalls = 0;
let insertValues: unknown = null;
let updateCalls = 0;
let updateSet: unknown = null;
let deleteCalls = 0;

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts: Node[]) => ({ op: 'and', parts })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
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
    select: vi.fn(() => builder(selectQueue.length ? selectQueue.shift() : [])),
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
const DAY_MS = 24 * 60 * 60 * 1000;

function poolRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'me-1',
    questionId: 'q-1',
    questionText: 'Who wrote the Storia d’Italia?',
    canonicalSubcategory: 'history',
    category: 'general_knowledge',
    recoveredAt: new Date(Date.now() - 2 * DAY_MS),
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

  it('orders by created_at DESC (recency for the dismissed shelf)', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    expect(capturedOrderBy).toEqual({ op: 'desc', column: 'me.createdAt' });
  });

  it('issues no insert/update/delete on the read path', async () => {
    await getRecoveredQuestionsForUser(VIEWER);
    expect(insertCalls).toBe(0);
    expect(updateCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });
});

describe('getRecoveredQuestionsForUser — deck / dismissed split', () => {
  it('maps the answer/explainer fields for the reveal', async () => {
    selectQueue = [[poolRow()], []]; // pool rows, then active set-aside ids
    const { deck } = await getRecoveredQuestionsForUser(VIEWER);
    expect(deck).toHaveLength(1);
    expect(deck[0].answer).toBe('Francesco Guicciardini');
    expect(deck[0].explanation).toBe('Full explainer.');
    expect(deck[0].creatorNote).toBeNull();
    expect(deck[0].setAside).toBe(false);
  });

  it('routes dismissed questions out of the deck and onto the dismissed shelf', async () => {
    selectQueue = [
      [
        poolRow({ id: 'me-a', questionId: 'q-a' }),
        poolRow({ id: 'me-b', questionId: 'q-b' }), // this one is dismissed
        poolRow({ id: 'me-c', questionId: 'q-c' }),
      ],
      [{ questionId: 'q-b' }], // active set-aside ids
    ];
    const { deck, dismissed } = await getRecoveredQuestionsForUser(VIEWER);
    expect(deck.map((q) => q.questionId).sort()).toEqual(['q-a', 'q-c']);
    expect(dismissed.map((q) => q.questionId)).toEqual(['q-b']);
    expect(dismissed[0].setAside).toBe(true);
  });

  it('bounds the deck by withinDays but keeps the dismissed shelf all-time', async () => {
    selectQueue = [
      [
        poolRow({ id: 'me-recent', questionId: 'q-recent' }),
        poolRow({
          id: 'me-old',
          questionId: 'q-old',
          recoveredAt: new Date(Date.now() - 40 * DAY_MS),
        }),
        poolRow({
          id: 'me-old-dismissed',
          questionId: 'q-old-dismissed',
          recoveredAt: new Date(Date.now() - 200 * DAY_MS),
        }),
      ],
      [{ questionId: 'q-old-dismissed' }],
    ];
    const { deck, dismissed } = await getRecoveredQuestionsForUser(VIEWER, { withinDays: 7 });
    expect(deck.map((q) => q.questionId)).toEqual(['q-recent']);
    // Far outside the 7-day window, but the shelf ignores the range bound.
    expect(dismissed.map((q) => q.questionId)).toEqual(['q-old-dismissed']);
  });

  it('leaves the deck unbounded when withinDays is null or omitted', async () => {
    const rows = [
      poolRow({ id: 'me-a', questionId: 'q-a' }),
      poolRow({
        id: 'me-b',
        questionId: 'q-b',
        recoveredAt: new Date(Date.now() - 400 * DAY_MS),
      }),
    ];
    selectQueue = [rows, []];
    const all = await getRecoveredQuestionsForUser(VIEWER);
    expect(all.deck).toHaveLength(2);

    selectQueue = [rows, []];
    const explicitNull = await getRecoveredQuestionsForUser(VIEWER, { withinDays: null });
    expect(explicitNull.deck).toHaveLength(2);
  });

  it('shuffles the deck (order follows Math.random, not row order)', async () => {
    selectQueue = [
      [
        poolRow({ id: 'me-a', questionId: 'q-a' }),
        poolRow({ id: 'me-b', questionId: 'q-b' }),
        poolRow({ id: 'me-c', questionId: 'q-c' }),
      ],
      [],
    ];
    // Fisher–Yates with random() = 0 swaps each element to the front:
    // [a,b,c] → i=2 swaps a/c → [c,b,a] → i=1 swaps b/c → [b,c,a].
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { deck } = await getRecoveredQuestionsForUser(VIEWER);
      expect(deck.map((q) => q.questionId)).toEqual(['q-b', 'q-c', 'q-a']);
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
