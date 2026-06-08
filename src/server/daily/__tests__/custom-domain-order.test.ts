import { beforeAll, describe, expect, it } from 'vitest';

import { domainKey } from '@/lib/knowledge/domain-key';

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
    // Mirrors the affected account: deep mined domains vs fresh picks. The count
    // map is keyed by domainKey() (matching getRecentDomainCounts), so build the
    // keys with the same fold the production code uses.
    const domains = [
      "Wagner's Ring Cycle",
      'Shakespearean Tragedy',
      'Classic Broadway Musicals (1940s-1960s)',
      'Animated Television Series (1970s-1980s)',
      'T.S. Eliot',
    ];
    const counts = new Map<string, number>([
      [domainKey("Wagner's Ring Cycle"), 12],
      [domainKey('Shakespearean Tragedy'), 15],
      [domainKey('Classic Broadway Musicals (1940s-1960s)'), 0],
      [domainKey('Animated Television Series (1970s-1980s)'), 0],
      [domainKey('T.S. Eliot'), 2],
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

  it('collapses spelling variants onto one canonical count', () => {
    // The generation history recorded a curly-apostrophe spelling, while the
    // user's selected domain uses the straight apostrophe. Both fold to the same
    // domainKey, so the mined count must apply to the selected variant and sink
    // it below a genuinely fresh domain.
    const ordered = orderCustomDomainsByLeastRecent(
      ["90's Hip-Hop", 'Bebop'],
      new Map([[domainKey('90’s Hip-Hop'), 9]]),
    );
    expect(ordered).toEqual(['Bebop', "90's Hip-Hop"]);
  });

  it('treats a domain absent from the counts map as count 0 (fresh)', () => {
    const ordered = orderCustomDomainsByLeastRecent(
      ['Mined', 'NeverGenerated'],
      new Map([[domainKey('Mined'), 7]]),
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
