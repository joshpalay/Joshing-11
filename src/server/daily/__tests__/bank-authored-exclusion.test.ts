import { beforeAll, describe, expect, it } from 'vitest';

// queries/daily.ts imports @/server/db, which throws at module load without a
// connection string. isBankRowServable / normalizeQuestionText / authoredAnswerKey
// are pure and never touch the DB; a dummy URL plus dynamic import (the repo
// convention) keeps the unit pure. Regression for the reported routing bug: a
// question the viewer AUTHORED and sent a friend came back to the viewer in
// their own +2 bonus. The bonus picks from the bank via pickBankSource, which
// skips any row whose verbatim text — OR whose domain+answer signature (the
// "same fact, different wording" backstop) — matches a question the viewer
// authored.
let isBankRowServable: typeof import('@/server/db/queries/daily').isBankRowServable;
let normalizeQuestionText: typeof import('@/server/db/queries/daily').normalizeQuestionText;
let authoredAnswerKey: typeof import('@/server/db/queries/daily').authoredAnswerKey;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ isBankRowServable, normalizeQuestionText, authoredAnswerKey } = await import(
    '@/server/db/queries/daily'
  ));
});

const DOMAIN = 'Musical Theatre';
const RENT =
  "According to the song 'Seasons of Love' in Rent, how many minutes are there in a year?";
const RENT_ANSWER = '525,600';

function row(
  questionText: string,
  {
    factKey = 'rent-seasons-of-love-minutes',
    answer = RENT_ANSWER,
    canonicalSubcategory = DOMAIN,
  }: { factKey?: string | null; answer?: string; canonicalSubcategory?: string | null } = {},
) {
  return { factKey, questionText, answer, canonicalSubcategory };
}

describe('normalizeQuestionText', () => {
  it('trims and lowercases so cross-table text matching is stable', () => {
    expect(normalizeQuestionText(`  ${RENT}  `)).toBe(RENT.toLowerCase());
  });
});

describe('authoredAnswerKey', () => {
  it('is domain-scoped and normalized so an answer only collides within its subcategory', () => {
    expect(authoredAnswerKey(DOMAIN, `  ${RENT_ANSWER}  `)).toBe(authoredAnswerKey(DOMAIN, RENT_ANSWER));
    expect(authoredAnswerKey(DOMAIN, RENT_ANSWER)).not.toBe(authoredAnswerKey('Film', RENT_ANSWER));
  });

  it('treats a null domain as the "unknown" bucket', () => {
    expect(authoredAnswerKey(null, RENT_ANSWER)).toBe(authoredAnswerKey('unknown', RENT_ANSWER));
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

  it('drops a RE-WORDED version of an authored fact via the domain+answer guard', () => {
    // Different wording (verbatim-text guard misses it) but the same answer in
    // the same subcategory — the same fact, so it must not be served back.
    const reworded = "In Rent's 'Seasons of Love', a year is measured in how many minutes?";
    const answerKeys = new Set([authoredAnswerKey(DOMAIN, RENT_ANSWER)]);
    expect(isBankRowServable(row(reworded), noAvoid, noAvoid, answerKeys)).toBe(false);
  });

  it('does NOT cross domains: same answer string in a different subcategory is served', () => {
    const answerKeys = new Set([authoredAnswerKey('Film', RENT_ANSWER)]);
    // Bank row is in Musical Theatre; the authored answer key was for Film.
    expect(isBankRowServable(row(RENT), noAvoid, noAvoid, answerKeys)).toBe(true);
  });

  it('serves a same-domain bank row with a DIFFERENT answer the viewer did not author', () => {
    const other = "Who composed the musical 'Rent'?";
    const authoredTexts = new Set([normalizeQuestionText(RENT)]);
    const answerKeys = new Set([authoredAnswerKey(DOMAIN, RENT_ANSWER)]);
    expect(
      isBankRowServable(
        row(other, { factKey: 'rent-composer-larson', answer: 'Jonathan Larson' }),
        noAvoid,
        authoredTexts,
        answerKeys,
      ),
    ).toBe(true);
  });

  it('still excludes rows whose fact_key is in the recent avoid set', () => {
    const avoidFactKeys = new Set(['rent-seasons-of-love-minutes']);
    expect(isBankRowServable(row(RENT), avoidFactKeys, noAvoid)).toBe(false);
  });

  it('drops rows lacking a fact_key (older bank rows)', () => {
    expect(isBankRowServable(row(RENT, { factKey: null }), noAvoid, noAvoid)).toBe(false);
  });

  it('serves a clean row when no avoid set matches', () => {
    expect(isBankRowServable(row(RENT), noAvoid, noAvoid)).toBe(true);
  });
});
