import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  playerMastery: [] as Row[],
  masteryEvents: [] as Row[],
  questions: [] as Row[],
  generatedQuestions: [] as Row[],
  skippedDailyQuestions: [] as Row[],
  sourceDomains: [] as string[],
}));

function isSourceDomain(value: unknown) {
  return typeof value === 'string' && state.sourceDomains.includes(value);
}

vi.mock('@/server/db', async () => {
  const schema = await vi.importActual<typeof import('@/server/db/schema')>('@/server/db/schema');

  function tableKind(table: unknown) {
    if (table === schema.playerMastery) return 'playerMastery';
    if (table === schema.masteryEvents) return 'masteryEvents';
    if (table === schema.questions) return 'questions';
    if (table === schema.generatedQuestions) return 'generatedQuestions';
    if (table === schema.skippedDailyQuestions) return 'skippedDailyQuestions';
    if (table === schema.declaredInterests) return 'declaredInterests';
    if (table === schema.profileDomainVisibility) return 'profileDomainVisibility';
    return 'unknown';
  }

  const tx = {
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(async () => {
          const kind = tableKind(table);
          if ('points' in selection && 'distinctQuestions' in selection) {
            const authorCreditEvents = state.masteryEvents.filter(
              (row) => isSourceDomain(row.canonicalSubcategory) && row.sourceType === 'author_credit',
            );
            return [{
              points: authorCreditEvents.reduce((sum, row) => sum + Number(row.awardedPoints ?? 0), 0),
              distinctQuestions: new Set(authorCreditEvents.map((row) => row.questionId)).size,
            }];
          }
          if (kind === 'declaredInterests') return [];
          if (kind === 'profileDomainVisibility') return [];
          return [];
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Row) => {
        const kind = tableKind(table);
        if (kind === 'playerMastery') {
          const existingIndex = state.playerMastery.findIndex(
            (row) => row.userId === values.userId && row.canonicalSubcategory === values.canonicalSubcategory,
          );
          if (existingIndex >= 0) {
            state.playerMastery[existingIndex] = { ...state.playerMastery[existingIndex], ...values };
          } else {
            state.playerMastery.push({ ...values });
          }
        }
        if (kind === 'masteryEvents') state.masteryEvents.push({ ...values });
        return { onConflictDoUpdate: vi.fn(async () => undefined) };
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        const kind = tableKind(table);
        if (kind === 'playerMastery') {
          state.playerMastery = state.playerMastery.filter((row) => !isSourceDomain(row.canonicalSubcategory));
        }
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Row) => ({
        where: vi.fn(async () => {
          const kind = tableKind(table);
          const rows = kind === 'masteryEvents'
            ? state.masteryEvents
            : kind === 'questions'
              ? state.questions
              : kind === 'generatedQuestions'
                ? state.generatedQuestions
                : kind === 'skippedDailyQuestions'
                  ? state.skippedDailyQuestions
                  : [];
          for (const row of rows) {
            if (isSourceDomain(row.canonicalSubcategory)) Object.assign(row, values);
          }
        }),
      })),
    })),
  };

  return {
    ...schema,
    db: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<void>) => callback(tx)),
    },
  };
});

import { applyMergesForUser } from '@/server/mastery/ceremony';

describe('applyMergesForUser', () => {
  beforeEach(() => {
    state.playerMastery = [];
    state.masteryEvents = [];
    state.questions = [];
    state.generatedQuestions = [];
    state.skippedDailyQuestions = [];
    state.sourceDomains = ['Ulysses – Structure & Symbolism'];
    vi.clearAllMocks();
  });

  it('creates a missing parent domain from a single facet source merge and retargets related rows', async () => {
    const sourceRow = {
      id: 'mastery-source',
      userId: 'user-1',
      canonicalSubcategory: 'Ulysses – Structure & Symbolism',
      broadCategory: 'Literature',
      totalPoints: 42,
      tier: 'solid' as const,
      tierReachedAt: null,
      seasonPointsStart: 7,
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    };

    state.playerMastery = [{ ...sourceRow }];
    state.masteryEvents = [
      {
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses – Structure & Symbolism',
        sourceType: 'answer',
        questionId: 'question-1',
        awardedPoints: 42,
      },
    ];
    state.questions = [{ id: 'question-1', creatorId: 'user-1', canonicalSubcategory: 'Ulysses – Structure & Symbolism' }];
    state.generatedQuestions = [{ id: 'generated-1', userId: 'user-1', canonicalSubcategory: 'Ulysses – Structure & Symbolism' }];
    state.skippedDailyQuestions = [{ id: 'skipped-1', userId: 'user-1', canonicalSubcategory: 'Ulysses – Structure & Symbolism' }];

    const details = await applyMergesForUser('user-1', [sourceRow], [{
      sources: ['Ulysses – Structure & Symbolism'],
      target: 'Ulysses',
      rationale: 'Facet should roll up to parent work.',
    }]);

    expect(details).toEqual([{ sources: ['Ulysses – Structure & Symbolism'], target: 'Ulysses', rationale: 'Facet should roll up to parent work.' }]);
    expect(state.playerMastery).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses',
        broadCategory: 'Literature',
        totalPoints: 42,
        tier: 'solid',
        seasonPointsStart: 7,
      }),
    ]);
    expect(state.playerMastery).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalSubcategory: 'Ulysses – Structure & Symbolism' }),
    ]));
    expect(state.masteryEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalSubcategory: 'Ulysses', questionId: 'question-1' }),
      expect.objectContaining({ canonicalSubcategory: 'Ulysses', sourceType: 'domain_merged' }),
    ]));
    expect(state.questions).toEqual([expect.objectContaining({ canonicalSubcategory: 'Ulysses', broadCategory: 'Literature' })]);
    expect(state.generatedQuestions).toEqual([expect.objectContaining({ canonicalSubcategory: 'Ulysses', broadCategory: 'Literature' })]);
    expect(state.skippedDailyQuestions).toEqual([expect.objectContaining({ canonicalSubcategory: 'Ulysses' })]);
  });
});
