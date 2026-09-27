import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// A dedicated schema lets this run beside other pg tests in one disposable DB.
describe.skipIf(!testDatabaseUrl)('same-territory merge — earned leaf awards (Postgres)', () => {
  let pool: typeof import('@/server/db').pool;
  let client: pg.PoolClient;
  let applyGraphFold: typeof import('@/server/knowledge/merge-domain').applyGraphFold;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must point to a local database ending in _test');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ pool } = await import('@/server/db'));
    ({ applyGraphFold } = await import('@/server/knowledge/merge-domain'));
    client = await pool.connect();
    await client.query('CREATE SCHEMA merge_leaf_awards_test');
    await client.query('SET search_path TO merge_leaf_awards_test');
    await client.query(`CREATE TABLE "KnowledgeNode" (
      id text PRIMARY KEY, label text NOT NULL, domain_key text NOT NULL UNIQUE
    )`);
    await client.query(`CREATE TABLE "KnowledgeEdge" (
      id text PRIMARY KEY, child_domain_key text NOT NULL, parent_domain_key text NOT NULL,
      UNIQUE(child_domain_key, parent_domain_key)
    )`);
    await client.query(`CREATE TABLE "KnowledgeParentMastery" (
      id text PRIMARY KEY, user_id text NOT NULL, parent_domain_key text NOT NULL,
      mastered_at timestamptz NOT NULL, UNIQUE(user_id, parent_domain_key)
    )`);
    await client.query(`CREATE TABLE "KnowledgeLeafMastery" (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id text NOT NULL, leaf_domain_key text NOT NULL,
      mastered_at timestamptz NOT NULL, UNIQUE(user_id, leaf_domain_key)
    )`);
  });

  beforeEach(async () => {
    for (const table of ['KnowledgeNode', 'KnowledgeEdge', 'KnowledgeParentMastery', 'KnowledgeLeafMastery']) {
      await client.query(`TRUNCATE "${table}"`);
    }
    await client.query(`INSERT INTO "KnowledgeNode" VALUES
      ('source', 'Old Name', 'old name'), ('target', 'New Name', 'new name')`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('RESET search_path');
    await client.query('DROP SCHEMA merge_leaf_awards_test CASCADE');
    client.release();
    await pool.end();
  });

  async function fold() {
    await client.query('BEGIN');
    try {
      const outcome = await applyGraphFold(client, {
        sourceKey: 'old name', targetKey: 'new name', targetLabel: 'New Name',
      });
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  it('carries source awards once and keeps the earliest date for players with both', async () => {
    await client.query(`INSERT INTO "KnowledgeLeafMastery" VALUES
      ('old-u1', 'u1', 'old name', '2026-01-01T00:00:00Z'),
      ('new-u1', 'u1', 'new name', '2026-02-01T00:00:00Z'),
      ('old-u2', 'u2', 'old name', '2026-03-01T00:00:00Z')`);

    expect(await fold()).toBe('merged_into_target_node');
    const awards = (await client.query(`SELECT user_id, leaf_domain_key, mastered_at
      FROM "KnowledgeLeafMastery" ORDER BY user_id`)).rows;
    expect(awards).toEqual([
      { user_id: 'u1', leaf_domain_key: 'new name', mastered_at: new Date('2026-01-01T00:00:00Z') },
      { user_id: 'u2', leaf_domain_key: 'new name', mastered_at: new Date('2026-03-01T00:00:00Z') },
    ]);
    expect((await client.query(`SELECT domain_key FROM "KnowledgeNode"`)).rows).toEqual([
      { domain_key: 'new name' },
    ]);
  });

  it('follows a source node when the target is a new name', async () => {
    await client.query(`DELETE FROM "KnowledgeNode" WHERE domain_key = 'new name'`);
    await client.query(`INSERT INTO "KnowledgeLeafMastery" VALUES
      ('old-u1', 'u1', 'old name', '2026-01-01T00:00:00Z')`);

    expect(await fold()).toBe('rekeyed_source_node');
    expect((await client.query(`SELECT label, domain_key FROM "KnowledgeNode"`)).rows).toEqual([
      { label: 'New Name', domain_key: 'new name' },
    ]);
    expect((await client.query(`SELECT leaf_domain_key FROM "KnowledgeLeafMastery"`)).rows).toEqual([
      { leaf_domain_key: 'new name' },
    ]);
  });

  it('carries a previously orphaned award even when its graph node is gone', async () => {
    await client.query(`DELETE FROM "KnowledgeNode" WHERE domain_key = 'old name'`);
    await client.query(`INSERT INTO "KnowledgeLeafMastery" VALUES
      ('old-u1', 'u1', 'old name', '2026-01-01T00:00:00Z')`);

    expect(await fold()).toBe('none');
    expect((await client.query(`SELECT leaf_domain_key FROM "KnowledgeLeafMastery"`)).rows).toEqual([
      { leaf_domain_key: 'new name' },
    ]);
  });

  it('rolls back the award transfer if a later graph step fails', async () => {
    await client.query(`INSERT INTO "KnowledgeLeafMastery" VALUES
      ('old-u1', 'u1', 'old name', '2026-01-01T00:00:00Z')`);
    await client.query(`CREATE FUNCTION reject_source_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected graph failure'; END $$`);
    await client.query(`CREATE TRIGGER reject_source_delete BEFORE DELETE ON "KnowledgeNode"
      FOR EACH ROW EXECUTE FUNCTION reject_source_delete()`);
    try {
      await expect(fold()).rejects.toThrow('injected graph failure');
      expect((await client.query(`SELECT leaf_domain_key FROM "KnowledgeLeafMastery"`)).rows).toEqual([
        { leaf_domain_key: 'old name' },
      ]);
      expect((await client.query(`SELECT domain_key FROM "KnowledgeNode" ORDER BY domain_key`)).rows).toEqual([
        { domain_key: 'new name' }, { domain_key: 'old name' },
      ]);
    } finally {
      await client.query('DROP TRIGGER reject_source_delete ON "KnowledgeNode"');
      await client.query('DROP FUNCTION reject_source_delete()');
    }
  });
});
