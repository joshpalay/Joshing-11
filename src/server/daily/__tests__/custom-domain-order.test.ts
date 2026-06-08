import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. The helper under test never touches the DB;
// a dummy URL plus dynamic import (the repo convention) keeps the unit pure.
let orderCustomDomainsByLeastRecent: typeof import('@/server/daily/generate-questions').orderCustomDomainsByLeastRecent;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ orderCustomDomainsByLeastRecent } = await import('@/server/daily/generate-questions'));
});

describe('orderCustomDomainsByLeastRecent', () => {
  it('puts the least-recently-generated domains first', () => {
    // Mirrors the affected account: deep mined domains vs fresh picks.
    const domains = [
      "Wagner's Ring Cycle",
      'Shakespearean Tragedy',
      'Classic Broadway Musicals (1940s-1960s)',
      'Animated Television Series (1970s-1980s)',
      'T.S. Eliot',
    ];
    const counts = new Map<string, number>([
      ["Wagner's Ring Cycle", 12],
      ['Shakespearean Tragedy', 15],
      ['Classic Broadway Musicals (1940s-1960s)', 0],
      ['Animated Television Series (1970s-1980s)', 0],
      ['T.S. Eliot', 2],
    ]);

    const ordered = orderCustomDomainsByLeastRecent(domains, counts);

    // Fresh (0-count) domains lead; the two heavily-mined ones sink to the end.
    expect(ordered.slice(0, 2)).toEqual([
      'Classic Broadway Musicals (1940s-1960s)',
      'Animated Television Series (1970s-1980s)',
    ]);
    expect(ordered[2]).toBe('T.S. Eliot');
    expect(ordered.slice(-2)).toEqual([
      "Wagner's Ring Cycle",
      'Shakespearean Tragedy',
    ]);
  });

  it('treats a domain absent from the counts map as count 0 (fresh)', () => {
    const ordered = orderCustomDomainsByLeastRecent(
      ['Mined', 'NeverGenerated'],
      new Map([['Mined', 7]]),
    );
    expect(ordered).toEqual(['NeverGenerated', 'Mined']);
  });

  it('is stable for equal counts (preserves selection order)', () => {
    const domains = ['A', 'B', 'C'];
    const ordered = orderCustomDomainsByLeastRecent(domains, new Map());
    expect(ordered).toEqual(['A', 'B', 'C']);
  });

  it('does not mutate the input array', () => {
    const domains = ['A', 'B'];
    orderCustomDomainsByLeastRecent(domains, new Map([['A', 5]]));
    expect(domains).toEqual(['A', 'B']);
  });

  it('returns an empty array unchanged', () => {
    expect(orderCustomDomainsByLeastRecent([], new Map())).toEqual([]);
  });
});
