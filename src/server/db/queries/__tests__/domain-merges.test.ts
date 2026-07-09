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

// A scripted stand-in for a pg client: canned rows per query shape, and every
// statement recorded so the test can assert WHICH writes the merge performed.
// This is what proves the unification — the label path (applyDomainMerges) now
// runs the SAME graph fold as the tree's merge, instead of orphaning nodes.
function fakeClient(nodeKeys: string[]) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      const sql = text;
      calls.push({ sql, params });
      if (sql.includes('information_schema.columns')) {
        return { rows: [{ table_name: 'GeneratedQuestion', column_name: 'canonical_subcategory' }] };
      }
      // Census read (the only GROUP BY select in the flow).
      if (sql.includes('GROUP BY 1')) {
        return { rows: [{ label: 'Evil Spy School', n: '4' }] };
      }
      // applyGraphFold's node-existence check.
      if (sql.includes('FROM "KnowledgeNode"') && sql.startsWith('SELECT')) {
        return { rows: nodeKeys.map((k) => ({ domain_key: k })) };
      }
      if (sql.startsWith('UPDATE "GeneratedQuestion"')) return { rows: [], rowCount: 4 };
      if (sql.startsWith('SELECT')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: client as unknown as Parameters<typeof mod.applyDomainMerges>[0], calls };
}

describe('applyDomainMerges — graph follow-through (the unified engine)', () => {
  const spec = [{ target: 'Spy School', sources: ['Evil Spy School'] }];
  const has = (calls: Array<{ sql: string }>, fragment: string) =>
    calls.some((c) => c.sql.includes(fragment));

  it('folds the source label’s node into an existing target node (edges re-point, node dies)', async () => {
    const { client, calls } = fakeClient(['evil spy school', 'spy school']);
    const result = await mod.applyDomainMerges(client, spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retargeted).toBe(4);
    expect(has(calls, 'UPDATE "KnowledgeEdge" SET parent_domain_key')).toBe(true);
    expect(has(calls, 'UPDATE "KnowledgeEdge" SET child_domain_key')).toBe(true);
    expect(has(calls, 'DELETE FROM "KnowledgeNode"')).toBe(true);
    expect(result.log.some((l) => l.includes('folded graph node'))).toBe(true);
    // One transaction around everything, corpus AND graph.
    expect(calls[calls.length - 1].sql).toBe('COMMIT');
  });

  it('re-keys the source node to the surviving label when the target has no node', async () => {
    const { client, calls } = fakeClient(['evil spy school']);
    const result = await mod.applyDomainMerges(client, spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rekey = calls.find((c) => c.sql.includes('UPDATE "KnowledgeNode" SET label'));
    expect(rekey).toBeDefined();
    expect(rekey!.params).toEqual(['evil spy school', 'Spy School', 'spy school']);
    expect(has(calls, 'DELETE FROM "KnowledgeNode"')).toBe(false);
    expect(result.log.some((l) => l.includes('re-keyed graph node'))).toBe(true);
  });

  it('touches no graph tables when neither label has a node', async () => {
    const { client, calls } = fakeClient([]);
    const result = await mod.applyDomainMerges(client, spec);
    expect(result.ok).toBe(true);
    expect(has(calls, '"KnowledgeEdge"')).toBe(false);
    expect(has(calls, 'DELETE FROM "KnowledgeNode"')).toBe(false);
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
