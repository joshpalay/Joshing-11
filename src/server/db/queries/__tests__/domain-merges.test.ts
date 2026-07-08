import { beforeAll, describe, expect, it } from 'vitest';

import type { MergeCensusRow } from '@/server/db/queries/domain-merges';

// domain-merges.ts imports @/server/db (the pool), which throws at load without a
// connection string. The pure helpers under test never open a connection; a dummy
// URL + dynamic import keeps them reachable, mirroring quality-aggregation.test.ts.
let mod: typeof import('@/server/db/queries/domain-merges');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/db/queries/domain-merges');
});

function row(over: Partial<MergeCensusRow>): MergeCensusRow {
  return { table: 'GeneratedQuestion', column: 'canonical_subcategory', label: 'X', rows: 1, ...over };
}

describe('normalizeMergeSpecs', () => {
  it('trims, dedupes sources, and drops a source equal to its own target', () => {
    const out = mod.normalizeMergeSpecs([
      { target: '  Harry Potter Series  ', sources: [' J.K. Rowling’s HP ', 'J.K. Rowling’s HP'] },
    ]);
    expect(out).toEqual([{ target: 'Harry Potter Series', sources: ['J.K. Rowling’s HP'] }]);
  });

  it('drops a spec whose only source is the target (a no-op self-merge)', () => {
    const out = mod.normalizeMergeSpecs([{ target: 'UX Design', sources: ['UX Design'] }]);
    expect(out).toEqual([]);
  });

  it('drops specs with an empty target or no surviving sources', () => {
    const out = mod.normalizeMergeSpecs([
      { target: '   ', sources: ['A'] },
      { target: 'B', sources: ['   ', ''] },
    ]);
    expect(out).toEqual([]);
  });
});

describe('unhandledCensusRows', () => {
  it('passes tables the apply path knows (retarget / drop-cache / consolidate)', () => {
    const census: MergeCensusRow[] = [
      row({ table: 'GeneratedQuestion', column: 'canonical_subcategory' }),
      row({ table: 'PLAYER_MASTERY', column: 'canonical_subcategory' }),
      row({ table: 'DomainRelation', column: 'child_domain' }),
      row({ table: 'DeclaredInterest', column: 'domain' }),
    ];
    expect(mod.unhandledCensusRows(census)).toEqual([]);
  });

  it('flags a table the apply path cannot consolidate (would abort)', () => {
    const census: MergeCensusRow[] = [
      row({ table: 'GeneratedQuestion', column: 'canonical_subcategory' }),
      row({ table: 'SomeNewTable', column: 'domain', rows: 3 }),
    ];
    const unhandled = mod.unhandledCensusRows(census);
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0].table).toBe('SomeNewTable');
  });
});
