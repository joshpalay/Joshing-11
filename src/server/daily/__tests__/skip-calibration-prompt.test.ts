import { beforeAll, describe, expect, it } from 'vitest';

// buildUserPrompt's skip-calibration block ("The player has recently passed on
// questions in these areas…") existed since the prompt was written but was
// only wired to real skip data in 2026-06 (audit finding Q3a). These tests pin
// the rendering contract that wiring depends on: the block appears only for
// domains in BOTH the round and the skips map, with correct pluralization, and
// is absent when no skips are passed.
//
// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. buildUserPrompt never touches the DB; a dummy
// URL plus dynamic import (the repo convention) keeps the unit pure.
let buildUserPrompt: typeof import('@/server/daily/generate-questions').buildUserPrompt;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ buildUserPrompt } = await import('@/server/daily/generate-questions'));
});

const noPrev: [] = [];

describe('buildUserPrompt skip calibration (domainSkips)', () => {
  it('renders the pass-calibration block for skipped domains in the round', () => {
    const prompt = buildUserPrompt(
      ['Mrs. Dalloway', 'Weimar Cinema'],
      2,
      noPrev,
      noPrev,
      new Map([
        ['Mrs. Dalloway', 3],
        ['Weimar Cinema', 1],
      ]),
    );
    expect(prompt).toContain('The player has recently passed on questions in these areas');
    expect(prompt).toContain('- Mrs. Dalloway (3 passes in the last 7 days)');
    expect(prompt).toContain('- Weimar Cinema (1 pass in the last 7 days)');
  });

  it('omits skipped domains that are not part of this round', () => {
    const prompt = buildUserPrompt(
      ['Weimar Cinema'],
      1,
      noPrev,
      noPrev,
      new Map([
        ['Mrs. Dalloway', 3],
        ['Weimar Cinema', 2],
      ]),
    );
    expect(prompt).toContain('- Weimar Cinema (2 passes in the last 7 days)');
    // The prompt's static avoid-list boilerplate mentions Mrs. Dalloway as an
    // example, so assert on the calibration line, not the bare domain name.
    expect(prompt).not.toContain('- Mrs. Dalloway (3 passes');
  });

  it('renders no block when the map is empty, undefined, or all zero-count', () => {
    for (const skips of [undefined, new Map<string, number>(), new Map([['Weimar Cinema', 0]])]) {
      const prompt = buildUserPrompt(['Weimar Cinema'], 1, noPrev, noPrev, skips);
      expect(prompt).not.toContain('recently passed on');
    }
  });
});
