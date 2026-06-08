import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture what the insert helper writes and control how the db responds, mirroring
// the chainable-mock style in daily.test.ts.
let insertedValues: Record<string, unknown> | null = null;
let insertImpl: () => Promise<unknown> = async () => undefined;
let selectRows: unknown[] = [];

vi.mock('@/server/db', () => ({
  db: {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return insertImpl();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectRows),
      }),
    }),
  },
  contentReports: {
    reporterUserId: 'reporter_user_id',
    createdAt: 'created_at',
  },
}));

vi.mock('@/lib/games/timezone', () => ({
  getDailyAssignmentBounds: () => ({
    assignmentDate: new Date('2026-06-08T00:00:00.000Z'),
    assignmentDateStr: '2026-06-08',
    expiresAt: new Date('2026-06-09T00:00:00.000Z'),
  }),
}));

import {
  countContentReportsToday,
  insertContentReport,
} from '@/server/db/queries/content-reports';

afterEach(() => {
  insertedValues = null;
  insertImpl = async () => undefined;
  selectRows = [];
});

describe('insertContentReport', () => {
  it('writes an open report with the curated-question target and returns inserted', async () => {
    const result = await insertContentReport({
      reporterUserId: 'user-1',
      questionId: 'q-1',
      generatedQuestionId: null,
      category: 'incorrect',
      incorrectKind: 'answer_key',
      note: 'the key is wrong',
      suggestedAnswer: '42',
      surface: 'lately_result',
    });

    expect(result).toBe('inserted');
    expect(insertedValues).toMatchObject({
      reporterUserId: 'user-1',
      questionId: 'q-1',
      generatedQuestionId: null,
      category: 'incorrect',
      incorrectKind: 'answer_key',
      note: 'the key is wrong',
      suggestedAnswer: '42',
      surface: 'lately_result',
      status: 'open',
    });
  });

  it('writes the generated-question target without coercing it into questionId', async () => {
    await insertContentReport({
      reporterUserId: 'user-1',
      questionId: null,
      generatedQuestionId: 'gq-9',
      category: 'inappropriate',
      incorrectKind: null,
      note: 'not okay',
      suggestedAnswer: null,
      surface: 'round_recap',
    });

    expect(insertedValues).toMatchObject({
      questionId: null,
      generatedQuestionId: 'gq-9',
      category: 'inappropriate',
      incorrectKind: null,
    });
  });

  it('treats the one-open-report unique violation (23505) as an idempotent duplicate', async () => {
    insertImpl = async () => {
      throw Object.assign(new Error('duplicate key value'), { code: '23505' });
    };

    const result = await insertContentReport({
      reporterUserId: 'user-1',
      questionId: 'q-1',
      generatedQuestionId: null,
      category: 'inappropriate',
      incorrectKind: null,
      note: 'again',
      suggestedAnswer: null,
      surface: 'round_recap',
    });

    expect(result).toBe('duplicate');
  });

  it('rethrows non-unique-violation database errors', async () => {
    insertImpl = async () => {
      throw Object.assign(new Error('connection reset'), { code: '08006' });
    };

    await expect(
      insertContentReport({
        reporterUserId: 'user-1',
        questionId: 'q-1',
        generatedQuestionId: null,
        category: 'inappropriate',
        incorrectKind: null,
        note: 'x',
        suggestedAnswer: null,
        surface: 'round_recap',
      }),
    ).rejects.toThrow('connection reset');
  });
});

describe('countContentReportsToday', () => {
  it('returns the counted rows for the reporter in the current daily window', async () => {
    selectRows = [{ count: 7 }];
    expect(await countContentReportsToday('user-1')).toBe(7);
  });

  it('returns 0 when no rows are present', async () => {
    selectRows = [];
    expect(await countContentReportsToday('user-1')).toBe(0);
  });
});
