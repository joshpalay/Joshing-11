import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  playerMastery: [] as Row[],
  masteryEvents: [] as Row[],
  questions: [] as Row[],
  generatedQuestions: [] as Row[],
  skippedDailyQuestions: [] as Row[],
  profileDomainVisibility: [] as Row[],
  dailyPreferences: [] as Row[],
  userDomainDifficulties: [] as Row[],
  userDomainExclusions: [] as Row[],
  feedDismissedDomains: [] as Row[],
  sourceDomains: [] as string[],
  targetDomain: '' as string,
}));

function isSourceDomain(value: unknown) {
  return typeof value === 'string' && state.sourceDomains.includes(value);
}

function isMergedDomain(value: unknown) {
  return isSourceDomain(value) || (typeof value === 'string' && value === state.targetDomain);
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
    if (table === schema.dailyPreferences) return 'dailyPreferences';
    if (table === schema.userDomainDifficulties) return 'userDomainDifficulties';
    if (table === schema.userDomainExclusions) return 'userDomainExclusions';
    if (table === schema.feedDismissedDomains) return 'feedDismissedDomains';
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
          if (kind === 'dailyPreferences') return state.dailyPreferences;
          if (kind === 'userDomainDifficulties') return state.userDomainDifficulties.filter((row) => isMergedDomain(row.canonicalSubcategory));
          if (kind === 'userDomainExclusions') return state.userDomainExclusions.filter((row) => isSourceDomain(row.canonicalSubcategory));
          if (kind === 'profileDomainVisibility') {
            return state.profileDomainVisibility.filter(
              (row) => isMergedDomain(row.domain) || isMergedDomain(row.canonicalSubcategory),
            );
          }
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
        if (kind === 'profileDomainVisibility') state.profileDomainVisibility.push({ ...values });
        if (kind === 'userDomainDifficulties') {
          const existingIndex = state.userDomainDifficulties.findIndex(
            (row) => row.userId === values.userId && row.canonicalSubcategory === values.canonicalSubcategory,
          );
          if (existingIndex >= 0) {
            state.userDomainDifficulties[existingIndex] = { ...state.userDomainDifficulties[existingIndex], ...values };
          } else {
            state.userDomainDifficulties.push({ ...values });
          }
        }
        if (kind === 'userDomainExclusions') {
          const exists = state.userDomainExclusions.some(
            (row) => row.userId === values.userId && row.canonicalSubcategory === values.canonicalSubcategory,
          );
          if (!exists) state.userDomainExclusions.push({ ...values });
        }
        return {
          onConflictDoUpdate: vi.fn(async () => undefined),
          onConflictDoNothing: vi.fn(async () => undefined),
        };
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        const kind = tableKind(table);
        if (kind === 'playerMastery') {
          state.playerMastery = state.playerMastery.filter((row) => !isSourceDomain(row.canonicalSubcategory));
        }
        if (kind === 'profileDomainVisibility') {
          state.profileDomainVisibility = state.profileDomainVisibility.filter(
            (row) => !isMergedDomain(row.domain) && !isMergedDomain(row.canonicalSubcategory),
          );
        }
        if (kind === 'userDomainDifficulties') {
          state.userDomainDifficulties = state.userDomainDifficulties.filter((row) => !isSourceDomain(row.canonicalSubcategory));
        }
        if (kind === 'userDomainExclusions') {
          state.userDomainExclusions = state.userDomainExclusions.filter((row) => !isSourceDomain(row.canonicalSubcategory));
        }
        if (kind === 'feedDismissedDomains') {
          state.feedDismissedDomains = state.feedDismissedDomains.filter((row) => !isSourceDomain(row.canonicalSubcategory));
        }
      }),
    })),
    execute: vi.fn(async () => {
      const activeSourceDismissals = state.feedDismissedDomains.filter(
        (row) => isSourceDomain(row.canonicalSubcategory) && row.reinstatedAt == null,
      );
      const hasActiveTarget = state.feedDismissedDomains.some(
        (row) => row.canonicalSubcategory === state.targetDomain && row.reinstatedAt == null,
      );
      if (activeSourceDismissals.length > 0 && !hasActiveTarget) {
        state.feedDismissedDomains.push({
          id: 'dismissed-target',
          userId: 'user-1',
          canonicalSubcategory: state.targetDomain,
          dismissedAt: activeSourceDismissals[0].dismissedAt,
          reinstatedAt: null,
        });
      }
    }),
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
                  : kind === 'dailyPreferences'
                    ? state.dailyPreferences
                    : [];
          for (const row of rows) {
            if (kind === 'dailyPreferences' || isSourceDomain(row.canonicalSubcategory)) Object.assign(row, values);
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
    state.profileDomainVisibility = [];
    state.dailyPreferences = [];
    state.userDomainDifficulties = [];
    state.userDomainExclusions = [];
    state.feedDismissedDomains = [];
    state.sourceDomains = ['Ulysses – Structure & Symbolism'];
    state.targetDomain = 'Ulysses';
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

  it('keeps the tidied target private when any source visibility is private', async () => {
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
    state.profileDomainVisibility = [
      {
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses – Structure & Symbolism',
        domain: 'Ulysses – Structure & Symbolism',
        visibility: 'private',
        isVisible: false,
      },
      {
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses',
        domain: 'Ulysses',
        visibility: 'public',
        isVisible: true,
      },
    ];

    await applyMergesForUser('user-1', [sourceRow], [{
      sources: ['Ulysses – Structure & Symbolism'],
      target: 'Ulysses',
      rationale: 'Facet should roll up to parent work.',
    }]);

    expect(state.profileDomainVisibility).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses',
        domain: 'Ulysses',
        visibility: 'private',
        isVisible: false,
      }),
    ]);
  });

  it('retargets user domain label tables and removes source domain references', async () => {
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
    state.dailyPreferences = [{
      id: 'daily-pref-1',
      userId: 'user-1',
      selectedDomains: ['Ulysses – Structure & Symbolism', 'Ulysses', 'Modernism'],
    }];
    state.userDomainDifficulties = [
      {
        id: 'difficulty-source',
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses – Structure & Symbolism',
        servedDifficulty: 'specialist',
        consecutiveCorrect: 1,
        consecutiveIncorrect: 0,
        lastUpdated: new Date('2026-05-05T00:00:00.000Z'),
      },
      {
        id: 'difficulty-target',
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses',
        servedDifficulty: 'accessible',
        consecutiveCorrect: 0,
        consecutiveIncorrect: 1,
        lastUpdated: new Date('2026-05-01T00:00:00.000Z'),
      },
    ];
    state.userDomainExclusions = [{
      id: 'exclusion-source',
      userId: 'user-1',
      canonicalSubcategory: 'Ulysses – Structure & Symbolism',
      excludedAt: new Date('2026-05-02T00:00:00.000Z'),
    }];
    state.feedDismissedDomains = [
      {
        id: 'dismissed-source',
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses – Structure & Symbolism',
        dismissedAt: new Date('2026-05-03T00:00:00.000Z'),
        reinstatedAt: null,
      },
    ];

    await applyMergesForUser('user-1', [sourceRow], [{
      sources: ['Ulysses – Structure & Symbolism'],
      target: 'Ulysses',
      rationale: 'Facet should roll up to parent work.',
    }]);

    expect(state.dailyPreferences[0].selectedDomains).toEqual(['Ulysses', 'Modernism']);
    expect(state.userDomainDifficulties).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        canonicalSubcategory: 'Ulysses',
        servedDifficulty: 'specialist',
        consecutiveCorrect: 1,
        consecutiveIncorrect: 0,
      }),
    ]);
    expect(state.userDomainExclusions).toEqual([
      expect.objectContaining({ userId: 'user-1', canonicalSubcategory: 'Ulysses' }),
    ]);
    expect(state.feedDismissedDomains).toEqual([
      expect.objectContaining({ userId: 'user-1', canonicalSubcategory: 'Ulysses', reinstatedAt: null }),
    ]);

    const sourceDomainReferences = [
      ...state.dailyPreferences.flatMap((row) => row.selectedDomains as string[]),
      ...state.userDomainDifficulties.map((row) => row.canonicalSubcategory),
      ...state.userDomainExclusions.map((row) => row.canonicalSubcategory),
      ...state.feedDismissedDomains.map((row) => row.canonicalSubcategory),
    ].filter((domain) => domain === 'Ulysses – Structure & Symbolism');
    expect(sourceDomainReferences).toEqual([]);
  });
});
