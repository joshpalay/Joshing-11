import { beforeAll, describe, expect, it } from 'vitest';

// queries/daily.ts imports @/server/db, which throws at module load without a
// connection string. isBankRowServable / normalizeQuestionText are pure and
// never touch the DB; a dummy URL plus dynamic import (the repo convention)
// keeps the unit pure. Regression for the reported routing bug: a question the
// viewer AUTHORED and sent a friend came back to the viewer in their own +2
// bonus. The bonus picks from the bank via pickBankSource, which now skips any
// row whose text matches a question the viewer authored.
let isBankRowServable: typeof import('@/server/db/queries/daily').isBankRowServable;
let normalizeQuestionText: typeof import('@/server/db/queries/daily').normalizeQuestionText;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ isBankRowServable, normalizeQuestionText } = await import('@/server/db/queries/daily'));
});

const RENT =
  "According to the song 'Seasons of Love' in Rent, how many minutes are there in a year?";

function row(questionText: string, factKey: string | null = 'rent-seasons-of-love-minutes') {
  return { factKey, questionText };
}

describe('normalizeQuestionText', () => {
  it('trims and lowercases so cross-table text matching is stable', () => {
    expect(normalizeQuestionText(`  ${RENT}  `)).toBe(RENT.toLowerCase());
  });
});

describe('isBankRowServable', () => {
  const noAvoid = new Set<string>();

  it('drops the reported case: a bank row the viewer themselves authored', () => {
    const authored = new Set([normalizeQuestionText(RENT)]);
    expect(isBankRowServable(row(RENT), noAvoid, authored)).toBe(false);
  });

  it('matches authored text regardless of surrounding whitespace/case', () => {
    const authored = new Set([normalizeQuestionText(RENT)]);
    expect(isBankRowServable(row(`  ${RENT.toUpperCase()}  `), noAvoid, authored)).toBe(false);
  });

  it('serves a bank row in the same domain the viewer did NOT author', () => {
    const authored = new Set([normalizeQuestionText(RENT)]);
    const other = "Who composed the musical 'Rent'?";
    expect(isBankRowServable(row(other, 'rent-composer-larson'), noAvoid, authored)).toBe(true);
  });

  it('still excludes rows whose fact_key is in the recent avoid set', () => {
    const avoidFactKeys = new Set(['rent-seasons-of-love-minutes']);
    expect(isBankRowServable(row(RENT), avoidFactKeys, noAvoid)).toBe(false);
  });

  it('drops rows lacking a fact_key (older bank rows)', () => {
    expect(isBankRowServable(row(RENT, null), noAvoid, noAvoid)).toBe(false);
  });

  it('serves a clean row when no avoid set matches', () => {
    expect(isBankRowServable(row(RENT), noAvoid, noAvoid)).toBe(true);
  });
});
