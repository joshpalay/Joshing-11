import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts and retrieval-config import @/server/db, which throws at
// module load without a connection string. The helpers under test are pure; a
// dummy URL plus dynamic import (repo convention) keeps the units pure.
let mod: typeof import('@/server/daily/generate-questions');
let cfg: typeof import('@/server/daily/retrieval-config');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/daily/generate-questions');
  cfg = await import('@/server/daily/retrieval-config');
});

describe('normalizeSourceRefs', () => {
  it('keeps http(s) URL strings and dedupes case-insensitively', () => {
    const refs = mod.normalizeSourceRefs([
      'https://www.britannica.com/x',
      'HTTPS://WWW.BRITANNICA.COM/X',
      'https://en.wikipedia.org/y',
    ]);
    expect(refs).toEqual(['https://www.britannica.com/x', 'https://en.wikipedia.org/y']);
  });

  it('extracts url from object form and drops non-http / junk entries', () => {
    const refs = mod.normalizeSourceRefs([
      { url: 'https://example.edu/a', name: 'Example' },
      { name: 'no url' },
      'ftp://nope',
      'not a url',
      42,
    ]);
    expect(refs).toEqual(['https://example.edu/a']);
  });

  it('returns [] for non-array input', () => {
    expect(mod.normalizeSourceRefs(undefined)).toEqual([]);
    expect(mod.normalizeSourceRefs('https://x.com')).toEqual([]);
  });
});

describe('distinctSourceHostCount', () => {
  it('counts distinct registrable hosts, ignoring www and path', () => {
    expect(
      mod.distinctSourceHostCount([
        'https://www.britannica.com/a',
        'https://britannica.com/b',
        'https://en.wikipedia.org/c',
      ]),
    ).toBe(2);
  });

  it('mirrors of the same host count once (the corroboration trap)', () => {
    expect(
      mod.distinctSourceHostCount([
        'https://site.com/page1',
        'https://site.com/page2',
      ]),
    ).toBe(1);
  });
});

describe('parseGroundedQuestions', () => {
  const valid = {
    questions: [
      {
        canonical_subcategory: 'Late Tchaikovsky',
        broad_category: 'Music',
        question_text: 'What tempo marking closes the Pathétique?',
        answer: 'Adagio lamentoso',
        explainer: 'The finale is marked Adagio lamentoso, an unusual slow close.',
        difficulty_estimate: 'moderate',
        fact_key: 'tchaikovsky-pathetique-final-tempo',
        sub_angles: ['Pathétique', 'finale'],
        question_shape: 'technique_or_term',
        source_refs: ['https://en.wikipedia.org/wiki/x', 'https://www.britannica.com/y'],
      },
    ],
  };

  it('parses questions and attaches normalized source_refs', () => {
    const out = mod.parseGroundedQuestions(JSON.stringify(valid));
    expect(out).toHaveLength(1);
    expect(out[0].answer).toBe('Adagio lamentoso');
    expect(out[0].source_refs).toHaveLength(2);
  });

  it('defaults source_refs to [] when the model omits them', () => {
    const noRefs = JSON.parse(JSON.stringify(valid));
    delete noRefs.questions[0].source_refs;
    const out = mod.parseGroundedQuestions(JSON.stringify(noRefs));
    expect(out[0].source_refs).toEqual([]);
  });

  it('drops items that fail the base contract (generic subcategory)', () => {
    const generic = JSON.parse(JSON.stringify(valid));
    generic.questions[0].canonical_subcategory = 'General Knowledge';
    expect(mod.parseGroundedQuestions(JSON.stringify(generic))).toHaveLength(0);
  });
});

describe('estimateCallUsd', () => {
  it('prices searches and tokens additively', () => {
    const usd = cfg.estimateCallUsd({
      webSearches: 10,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // 10 * $0.01 + 1M * $3/M = $0.10 + $3.00
    expect(usd).toBeCloseTo(3.1, 5);
  });
});
