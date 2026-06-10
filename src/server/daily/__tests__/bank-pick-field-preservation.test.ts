import { beforeEach, describe, expect, it, vi } from 'vitest';

// BP-1 / audit finding Q4 regression: a bank reuse inserts a per-viewer COPY of
// the source GeneratedQuestion, and that copy must carry the question-intrinsic
// quality/verification fields earned at generation time (verify-once-reuse-many,
// PRD-D-5 §3) — insideJoke, trustTier, askToAnswerVerified, acceptableVariants,
// sourceRefs, perishable. Before the fix the copy silently reset all of them:
// the aside vanished, a right-but-rephrased answer graded wrong again on reuse,
// and earned trust dropped to `unverified`.
//
// The complementary seams are covered elsewhere: grading's accepted-variant
// fast path in src/server/__tests__/grading-fail-toward-player.test.ts, and the
// answer route passing the copy row's acceptableVariants into gradeAnswer in
// src/app/api/daily/answer/__tests__/route.test.ts.
//
// Strategy: drive generateBonusQuestionsForDomains through a bank HIT (the +2
// path shares pickBankPicksForDomains with the core five) with the DB and the
// daily query module mocked, and assert on the values handed to db.insert.

const mocks = vi.hoisted(() => ({
  getRecentDailyQuestionTexts: vi.fn(),
  getRecentFactKeys: vi.fn(),
  getAuthoredQuestionTexts: vi.fn(),
  pickBankSource: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock('@/server/db/queries/daily', () => ({
  getRecentDailyQuestionTexts: mocks.getRecentDailyQuestionTexts,
  getRecentFactKeys: mocks.getRecentFactKeys,
  getAuthoredQuestionTexts: mocks.getAuthoredQuestionTexts,
  getRecentDomainCounts: vi.fn(),
  getRecentSkipCountsByDomain: vi.fn(),
  getRecentSubAnglesByDomain: vi.fn(),
  getKnowledgeBase: vi.fn(),
  pickBankSource: mocks.pickBankSource,
  normalizeQuestionText: (text: string) => text.trim().toLowerCase(),
}));

vi.mock('@/server/db', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          mocks.insertValues(values);
          return [{ id: 'copy-1', ...values }];
        },
      }),
    }),
  },
  generatedQuestions: {},
}));

import { generateBonusQuestionsForDomains } from '@/server/daily/generate-questions';

// A fully-decorated source row as pickBankSource now returns it: every
// question-intrinsic quality field populated with a distinctive value.
const BANK_SOURCE = {
  questionText: 'Scarpia is the villain in what Puccini opera?',
  answer: 'Tosca',
  explainer: 'Baron Scarpia is the chief of police in Tosca.',
  broadCategory: 'Music',
  canonicalSubcategory: 'Puccini Operas',
  difficultyEstimate: 'accessible',
  basePoints: 100,
  factKey: 'tosca-scarpia-villain-opera',
  subAngles: ['Scarpia', 'Tosca Act I'],
  insideJoke: 'Between us — Scarpia never stood a chance.',
  trustTier: 'machine_verified' as const,
  askToAnswerVerified: true,
  acceptableVariants: ['Floria Tosca'],
  sourceRefs: ['https://example.edu/tosca', 'https://example.org/puccini'],
  perishable: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRecentDailyQuestionTexts.mockResolvedValue([]);
  mocks.getRecentFactKeys.mockResolvedValue([]);
  mocks.getAuthoredQuestionTexts.mockResolvedValue([]);
  mocks.pickBankSource.mockResolvedValue(BANK_SOURCE);
});

describe('bank-pick serving copy preserves earned quality fields (Q4)', () => {
  it('carries aside, trust, variants, provenance and perishable onto the copy', async () => {
    const results = await generateBonusQuestionsForDomains('viewer-1', ['Puccini Operas']);

    expect(results).toHaveLength(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    const values = mocks.insertValues.mock.calls[0][0] as Record<string, unknown>;

    expect(values).toMatchObject({
      insideJoke: BANK_SOURCE.insideJoke,
      trustTier: 'machine_verified',
      askToAnswerVerified: true,
      acceptableVariants: ['Floria Tosca'],
      sourceRefs: BANK_SOURCE.sourceRefs,
      perishable: false,
    });
    // The served row (what /api/daily/answer later reads) carries the variants.
    expect(results[0].question.acceptableVariants).toEqual(['Floria Tosca']);
  });

  it('keeps per-viewer fields viewer-scoped and does NOT carry play stats', async () => {
    await generateBonusQuestionsForDomains('viewer-1', ['Puccini Operas']);

    const values = mocks.insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values.userId).toBe('viewer-1');
    expect(values.expiresAt).toBeInstanceOf(Date);
    expect(values.usedInQueue).toBe(false);
    // Play stats accrue per row — a copy must start fresh, not inherit them.
    expect(values).not.toHaveProperty('nAnswered');
    expect(values).not.toHaveProperty('empiricalCorrectRate');
    // Embedding-dedup bookkeeping is also per-row, never copied.
    expect(values).not.toHaveProperty('isDuplicate');
    expect(values).not.toHaveProperty('suppressedBy');
    expect(values).not.toHaveProperty('embedding');
  });
});
