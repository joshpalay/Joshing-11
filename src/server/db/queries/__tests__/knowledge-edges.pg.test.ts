import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('knowledge edge cycle guard — Postgres', () => {
  let pool: typeof import('@/server/db').pool;
  let graph: typeof import('@/server/db/queries/knowledge-graph');

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/joshing_category_cycle_test'
    ) {
      throw new Error(
        'TEST_DATABASE_URL must point to the local joshing_category_cycle_test database',
      );
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ pool } = await import('@/server/db'));
    graph = await import('@/server/db/queries/knowledge-graph');
    await pool.query(`CREATE TABLE "KnowledgeNode" (
      id text PRIMARY KEY, label text NOT NULL, domain_key text NOT NULL UNIQUE,
      node_kind text NOT NULL DEFAULT 'leaf', mastery_threshold integer,
      broad_category text, field_hue text, wikidata_qid text,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE "KnowledgeEdge" (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      child_domain_key text NOT NULL, parent_domain_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(child_domain_key, parent_domain_key))`);
    // applyGraphFold moves same-topic leaf awards before checking graph cycles.
    await pool.query(`CREATE TABLE "KnowledgeLeafMastery" (
      user_id text NOT NULL, leaf_domain_key text NOT NULL,
      mastered_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, leaf_domain_key))`);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE "KnowledgeEdge", "KnowledgeNode", "KnowledgeLeafMastery"`);
    await pool.query(`INSERT INTO "KnowledgeNode" (id, label, domain_key)
      VALUES ('a', 'A', 'a'), ('b', 'B', 'b'), ('c', 'C', 'c'), ('x', 'X', 'x')`);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "KnowledgeLeafMastery"');
    await pool.query('DROP TABLE IF EXISTS "KnowledgeEdge"');
    await pool.query('DROP TABLE IF EXISTS "KnowledgeNode"');
    await pool.end();
  });

  const edge = (childDomainKey: string, parentDomainKey: string) =>
    graph.createKnowledgeEdge({ childDomainKey, parentDomainKey }, 'admin');

  it('rejects an indirect loop while keeping valid, duplicate, and unknown-node behavior', async () => {
    expect(await edge('a', 'b')).toMatchObject({ ok: true });
    expect(await edge('b', 'c')).toMatchObject({ ok: true });
    expect(await edge('c', 'a')).toEqual({ ok: false, reason: 'self_edge' });
    expect(await edge('a', 'b')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await edge('x', 'missing')).toEqual({ ok: false, reason: 'unknown_node' });
    expect(await edge('a', 'a')).toEqual({ ok: false, reason: 'self_edge' });
    expect(
      (
        await pool.query(
          `SELECT child_domain_key, parent_domain_key FROM "KnowledgeEdge" ORDER BY 1`,
        )
      ).rows,
    ).toEqual([
      { child_domain_key: 'a', parent_domain_key: 'b' },
      { child_domain_key: 'b', parent_domain_key: 'c' },
    ]);
  });

  it('serializes opposite inserts so concurrent admins cannot commit a two-node loop', async () => {
    const results = await Promise.all([edge('a', 'b'), edge('b', 'a')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'self_edge' }]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "KnowledgeEdge"`)).rows[0].n).toBe(1);
  });

  it('guards the attach and ratify paths through the common edge writer', async () => {
    await edge('a', 'b');
    await edge('b', 'c');
    expect(
      await graph.attachChild({ childDomainKey: 'c', toParentDomainKey: 'a' }, 'admin'),
    ).toEqual({ ok: false, reason: 'self_edge' });
    expect(
      await graph.ratifyProposedParent(
        {
          childDomainKey: 'c',
          parentLabel: 'A',
          parentBroadCategory: null,
        },
        'admin',
      ),
    ).toEqual({ ok: false, reason: 'self_edge' });
    expect(
      await graph.ratifyStructureGroup(
        {
          parentLabel: 'A',
          broadCategory: null,
          masteryThreshold: null,
          childLabels: ['C'],
        },
        'admin',
      ),
    ).toMatchObject({ ok: true, edgesCreated: 0 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "KnowledgeEdge"`)).rows[0].n).toBe(2);
  });

  it('inverts a chain without treating the original link as a permanent loop', async () => {
    await edge('a', 'b');
    await edge('b', 'c');
    expect(
      await graph.invertKnowledgeEdge({ childDomainKey: 'a', parentDomainKey: 'b' }, 'admin'),
    ).toEqual({ ok: true });
    expect(
      (
        await pool.query(
          `SELECT child_domain_key, parent_domain_key FROM "KnowledgeEdge" ORDER BY 1`,
        )
      ).rows,
    ).toEqual([
      { child_domain_key: 'a', parent_domain_key: 'c' },
      { child_domain_key: 'b', parent_domain_key: 'a' },
    ]);
    expect(
      (await pool.query(`SELECT node_kind FROM "KnowledgeNode" WHERE id = 'a'`)).rows[0].node_kind,
    ).toBe('both');
  });

  it('rolls back inversion when another path still makes the reverse link cyclic', async () => {
    await edge('a', 'b');
    await edge('a', 'x');
    await edge('x', 'b');
    expect(
      await graph.invertKnowledgeEdge({ childDomainKey: 'a', parentDomainKey: 'b' }, 'admin'),
    ).toEqual({ ok: false, reason: 'self_edge' });
    expect(
      (
        await pool.query(
          `SELECT child_domain_key, parent_domain_key FROM "KnowledgeEdge" ORDER BY 1, 2`,
        )
      ).rows,
    ).toEqual([
      { child_domain_key: 'a', parent_domain_key: 'b' },
      { child_domain_key: 'a', parent_domain_key: 'x' },
      { child_domain_key: 'x', parent_domain_key: 'b' },
    ]);
    expect(
      (await pool.query(`SELECT node_kind FROM "KnowledgeNode" WHERE id = 'a'`)).rows[0].node_kind,
    ).toBe('leaf');
  });

  it('rejects folding an ancestor into its descendant before the merge commits', async () => {
    await edge('a', 'b');
    await edge('b', 'c');
    const { applyGraphFold, GraphCycleError } = await import('@/server/knowledge/merge-domain');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        applyGraphFold(client, {
          sourceKey: 'a',
          targetKey: 'c',
          targetLabel: 'C',
        }),
      ).rejects.toBeInstanceOf(GraphCycleError);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await pool.query(`SELECT domain_key FROM "KnowledgeNode" ORDER BY 1`)).rows).toEqual([
      { domain_key: 'a' },
      { domain_key: 'b' },
      { domain_key: 'c' },
      { domain_key: 'x' },
    ]);
    expect(
      (
        await pool.query(
          `SELECT child_domain_key, parent_domain_key FROM "KnowledgeEdge" ORDER BY 1`,
        )
      ).rows,
    ).toEqual([
      { child_domain_key: 'a', parent_domain_key: 'b' },
      { child_domain_key: 'b', parent_domain_key: 'c' },
    ]);
  });
});
