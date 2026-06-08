import { beforeEach, describe, expect, it, vi } from 'vitest';

// Structural drizzle mock so we can assert the exact admin outcome wiring: uphold
// sets status='upheld' and, for inappropriate-authored ONLY, writes
// questions.visibility='blocked'; generated-inappropriate writes no extra column;
// dismiss sets status='dismissed' (which lifts B-Report-3 suppression). Sentinels +
// mutable state live in vi.hoisted so the (hoisted) vi.mock factory can reference them.
const { CONTENT_REPORTS, QUESTIONS, GENERATED, USERS, state } = vi.hoisted(() => ({
  CONTENT_REPORTS: { __t: 'contentReports', id: 'cr.id', status: 'cr.status', category: 'cr.category', questionId: 'cr.questionId', generatedQuestionId: 'cr.generatedQuestionId', note: 'cr.note', suggestedAnswer: 'cr.suggestedAnswer', incorrectKind: 'cr.incorrectKind', surface: 'cr.surface', createdAt: 'cr.createdAt', reporterUserId: 'cr.reporterUserId', reviewDecision: 'cr.reviewDecision', reviewReason: 'cr.reviewReason', reviewedAt: 'cr.reviewedAt' },
  QUESTIONS: { __t: 'questions', id: 'q.id', questionText: 'q.questionText', answerText: 'q.answerText', visibility: 'q.visibility', creatorId: 'q.creatorId', source: 'q.source' },
  GENERATED: { __t: 'generatedQuestions', id: 'g.id', questionText: 'g.questionText', answer: 'g.answer' },
  USERS: { __t: 'users', id: 'u.id', displayName: 'u.displayName' },
  state: { selectRows: [] as unknown[], updates: [] as Array<{ table: unknown; set: Record<string, unknown>; where: unknown }> },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...parts) => ({ op: 'and', parts })),
  or: vi.fn((...parts) => ({ op: 'or', parts })),
  eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
  ne: vi.fn((column, value) => ({ op: 'ne', column, value })),
  gte: vi.fn((column, value) => ({ op: 'gte', column, value })),
  asc: vi.fn((column) => ({ op: 'asc', column })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  inArray: vi.fn((column, values) => ({ op: 'inArray', column, values })),
  notExists: vi.fn((query) => ({ op: 'notExists', query })),
  sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('@/server/db', () => {
  const makeSelect = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(state.selectRows),
      then: (resolve: (r: unknown[]) => unknown) => resolve(state.selectRows),
    };
    return chain;
  };
  return {
    db: {
      select: () => makeSelect(),
      update: (table: unknown) => ({
        set: (vals: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            state.updates.push({ table, set: vals, where: cond });
            return Promise.resolve();
          },
        }),
      }),
    },
    contentReports: CONTENT_REPORTS,
    questions: QUESTIONS,
    generatedQuestions: GENERATED,
    users: USERS,
  };
});

import { dismissReport, getOpenReportsForReview, upholdReport } from '@/server/db/queries/content-reports';

function questionVisibilityWrites() {
  return state.updates.filter((u) => u.table === QUESTIONS && u.set.visibility === 'blocked');
}
function reportStatusWrites() {
  return state.updates.filter((u) => u.table === CONTENT_REPORTS);
}

beforeEach(() => {
  state.selectRows = [];
  state.updates.length = 0;
});

describe('upholdReport', () => {
  it('upholds an inappropriate AUTHORED report and sets visibility=blocked (the only place)', async () => {
    state.selectRows = [{ category: 'inappropriate', questionId: 'q-1', generatedQuestionId: null, status: 'open' }];

    const result = await upholdReport('report-1', 'looks bad');

    expect(result).toEqual({ ok: true, action: 'upheld', category: 'inappropriate', hardRemoved: true });
    expect(reportStatusWrites()[0]?.set).toMatchObject({ status: 'upheld', reviewDecision: 'admin_upheld', reviewReason: 'looks bad' });
    expect(questionVisibilityWrites()).toHaveLength(1);
  });

  it('upholds an inappropriate GENERATED report without any visibility write (upheld report is terminal)', async () => {
    state.selectRows = [{ category: 'inappropriate', questionId: null, generatedQuestionId: 'g-1', status: 'open' }];

    const result = await upholdReport('report-2');

    expect(result).toEqual({ ok: true, action: 'upheld', category: 'inappropriate', hardRemoved: true });
    expect(questionVisibilityWrites()).toHaveLength(0); // no blocked column on generated; no migration
  });

  it('upholds an incorrect report without blocking the question', async () => {
    state.selectRows = [{ category: 'incorrect', questionId: 'q-1', generatedQuestionId: null, status: 'open' }];

    const result = await upholdReport('report-3');

    expect(result).toEqual({ ok: true, action: 'upheld', category: 'incorrect', hardRemoved: false });
    expect(questionVisibilityWrites()).toHaveLength(0);
  });

  it('is a no-op on a missing or already-resolved report', async () => {
    state.selectRows = [];
    expect(await upholdReport('missing')).toEqual({ ok: false, reason: 'not_found' });
    expect(reportStatusWrites()).toHaveLength(0);

    state.selectRows = [{ category: 'inappropriate', questionId: 'q-1', generatedQuestionId: null, status: 'upheld' }];
    expect(await upholdReport('done')).toEqual({ ok: false, reason: 'already_resolved' });
    expect(reportStatusWrites()).toHaveLength(0);
  });
});

describe('dismissReport', () => {
  it('dismisses an open report (lifting B-Report-3 suppression) and never blocks anything', async () => {
    state.selectRows = [{ category: 'inappropriate', status: 'open' }];

    const result = await dismissReport('report-4', 'not a problem');

    expect(result).toEqual({ ok: true, action: 'dismissed', category: 'inappropriate', hardRemoved: false });
    expect(reportStatusWrites()[0]?.set).toMatchObject({ status: 'dismissed', reviewDecision: 'admin_dismissed', reviewReason: 'not a problem' });
    expect(questionVisibilityWrites()).toHaveLength(0);
  });

  it('is a no-op on an already-resolved report', async () => {
    state.selectRows = [{ category: 'incorrect', status: 'dismissed' }];
    expect(await dismissReport('done')).toEqual({ ok: false, reason: 'already_resolved' });
    expect(reportStatusWrites()).toHaveLength(0);
  });
});

describe('getOpenReportsForReview', () => {
  it('resolves the target table + text/answer per row and exposes reporter identity', async () => {
    state.selectRows = [
      {
        id: 'r1', category: 'inappropriate', incorrectKind: null, note: 'n1', suggestedAnswer: null, surface: 'round_recap',
        createdAt: new Date('2026-06-01'), questionId: 'q-1', generatedQuestionId: null,
        questionText: 'curated?', questionAnswer: 'A', generatedText: null, generatedAnswer: null,
        reporterUserId: 'u-1', reporterName: 'Reporter One',
      },
      {
        id: 'r2', category: 'incorrect', incorrectKind: 'answer_key', note: 'n2', suggestedAnswer: 'B', surface: 'lately_result',
        createdAt: new Date('2026-06-02'), questionId: null, generatedQuestionId: 'g-9',
        questionText: null, questionAnswer: null, generatedText: 'generated?', generatedAnswer: 'G',
        reporterUserId: 'u-2', reporterName: null,
      },
    ];

    const result = await getOpenReportsForReview();

    expect(result[0]).toMatchObject({
      id: 'r1', target: { table: 'question', id: 'q-1' }, questionText: 'curated?', correctAnswer: 'A',
      reporterUserId: 'u-1', reporterName: 'Reporter One',
    });
    expect(result[1]).toMatchObject({
      id: 'r2', target: { table: 'generated', id: 'g-9' }, questionText: 'generated?', correctAnswer: 'G',
      reporterUserId: 'u-2',
    });
  });
});
