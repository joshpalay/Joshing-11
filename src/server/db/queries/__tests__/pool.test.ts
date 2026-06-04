import { describe, expect, it } from 'vitest';

import {
  empiricalRate,
  filterPooledQuestions,
  normalizeHumanRow,
  normalizeMachineRow,
  visibilityToScope,
  type PooledQuestion,
} from '@/server/db/queries/pool';
import { generatedQuestions, questions } from '@/server/db/schema';

type MachineRow = typeof generatedQuestions.$inferSelect;
type HumanRow = typeof questions.$inferSelect;

let seq = 0;

function machineRow(over: Partial<MachineRow> = {}): MachineRow {
  seq += 1;
  return {
    id: `gen-${seq}`,
    userId: 'recipient-user',
    canonicalSubcategory: 'Bowie-era Glam Rock',
    broadCategory: 'music',
    questionText: `Machine question ${seq}`,
    answer: `Machine answer ${seq}`,
    explainer: `Machine explainer ${seq}`,
    difficultyEstimate: 'moderate',
    basePoints: 10,
    factKey: `fact-${seq}`,
    subAngles: [],
    insideJoke: null,
    createdAt: new Date(2026, 0, seq + 1),
    expiresAt: new Date(2026, 1, seq + 1),
    usedInQueue: false,
    trustTier: 'machine_verified',
    scope: 'public',
    perishable: false,
    sourceRefs: [],
    nAnswered: 0,
    empiricalCorrectRate: null,
    isDuplicate: false,
    suppressedBy: null,
    ...over,
  } as MachineRow;
}

function humanRow(over: Partial<HumanRow> = {}): HumanRow {
  seq += 1;
  return {
    id: `q-${seq}`,
    creatorId: 'author-user',
    questionText: `Human question ${seq}`,
    answerText: `Human answer ${seq}`,
    factualExplanation: `Human explainer ${seq}`,
    explainerFull: null,
    canonicalSubcategory: 'Bowie-era Glam Rock',
    broadCategory: 'music',
    difficultyEstimate: 'moderate',
    visibility: 'public',
    askedCount: 0,
    correctCount: 0,
    correctRate: null,
    createdAt: new Date(2026, 0, seq + 1),
    deletedAt: null,
    trustTier: 'author_confirmed',
    perishable: false,
    sourceRefs: [],
    isDuplicate: false,
    suppressedBy: null,
    ...over,
  } as unknown as HumanRow;
}

describe('visibilityToScope', () => {
  it('maps friends -> friends_only and passes private/public through', () => {
    expect(visibilityToScope('friends')).toBe('friends_only');
    expect(visibilityToScope('private')).toBe('private');
    expect(visibilityToScope('public')).toBe('public');
  });
});

describe('empiricalRate', () => {
  it('computes correct/asked when there is play history', () => {
    expect(empiricalRate(4, 3, null)).toBeCloseTo(0.75);
  });
  it('falls back to the stored rate, then null, when nothing was asked', () => {
    expect(empiricalRate(0, 0, 0.5)).toBe(0.5);
    expect(empiricalRate(0, 0, null)).toBeNull();
  });
});

describe('normalizeMachineRow', () => {
  it('produces the unified shape with no author and scope from the column', () => {
    const row = normalizeMachineRow(machineRow({ scope: 'friends_only', nAnswered: 2, empiricalCorrectRate: 0.5 }));
    expect(row.origin).toBe('machine');
    expect(row.authorId).toBeNull();
    expect(row.scope).toBe('friends_only');
    expect(row.answer).toContain('Machine answer');
    expect(row.nAnswered).toBe(2);
    expect(row.empiricalCorrectRate).toBe(0.5);
  });
});

describe('normalizeHumanRow', () => {
  it('reuses visibility/askedCount/counts and exposes the author', () => {
    const row = normalizeHumanRow(humanRow({
      creatorId: 'jane',
      visibility: 'friends',
      askedCount: 10,
      correctCount: 6,
    }));
    expect(row.origin).toBe('human');
    expect(row.authorId).toBe('jane');
    expect(row.scope).toBe('friends_only');
    expect(row.answer).toContain('Human answer');
    expect(row.nAnswered).toBe(10);
    expect(row.empiricalCorrectRate).toBeCloseTo(0.6);
  });
});

describe('filterPooledQuestions — unified pool, default path unchanged', () => {
  function pool(): PooledQuestion[] {
    return [
      normalizeMachineRow(machineRow({ trustTier: 'machine_verified', scope: 'public' })),
      normalizeHumanRow(humanRow({ trustTier: 'author_confirmed', visibility: 'public' })),
    ];
  }

  it('returns BOTH machine and human questions by default (today\'s union)', () => {
    const result = filterPooledQuestions(pool());
    expect(result.map((r) => r.origin).sort()).toEqual(['human', 'machine']);
  });

  it('excludes suppressed (is_duplicate) rows by default', () => {
    const rows = [
      normalizeMachineRow(machineRow({ isDuplicate: true })),
      normalizeHumanRow(humanRow({ isDuplicate: false })),
    ];
    const result = filterPooledQuestions(rows);
    expect(result.map((r) => r.origin)).toEqual(['human']);
  });

  it('includes suppressed rows only when explicitly asked', () => {
    const rows = [normalizeMachineRow(machineRow({ isDuplicate: true }))];
    expect(filterPooledQuestions(rows)).toHaveLength(0);
    expect(filterPooledQuestions(rows, { includeSuppressed: true })).toHaveLength(1);
  });

  it('can filter by trust tier (capability — not wired into any live surface)', () => {
    const result = filterPooledQuestions(pool(), { trustTiers: ['author_confirmed'] });
    expect(result.map((r) => r.origin)).toEqual(['human']);
    const machineOnly = filterPooledQuestions(pool(), { trustTiers: ['machine_verified'] });
    expect(machineOnly.map((r) => r.origin)).toEqual(['machine']);
  });

  it('can filter by scope', () => {
    const rows = [
      normalizeMachineRow(machineRow({ scope: 'public' })),
      normalizeHumanRow(humanRow({ visibility: 'friends' })),
    ];
    const friendsOnly = filterPooledQuestions(rows, { scopes: ['friends_only'] });
    expect(friendsOnly.map((r) => r.origin)).toEqual(['human']);
  });

  it('can filter by origin and domain', () => {
    const rows = [
      normalizeMachineRow(machineRow({ canonicalSubcategory: 'Jazz' })),
      normalizeMachineRow(machineRow({ canonicalSubcategory: 'Opera' })),
      normalizeHumanRow(humanRow({ canonicalSubcategory: 'Jazz' })),
    ];
    expect(filterPooledQuestions(rows, { origins: ['machine'] })).toHaveLength(2);
    expect(filterPooledQuestions(rows, { domains: ['Jazz'] })).toHaveLength(2);
  });
});
