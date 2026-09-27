import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Run only against a disposable local database, never the application's .env.
describe.skipIf(!testDatabaseUrl)('knowledge node rename — Postgres transaction', () => {
  let pool: typeof import('@/server/db').pool;
  let update: typeof import('@/server/db/queries/knowledge-graph').updateKnowledgeNode;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/joshing_category_rename_test'
    ) {
      throw new Error(
        'TEST_DATABASE_URL must point to the local joshing_category_rename_test database',
      );
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ pool } = await import('@/server/db'));
    ({ updateKnowledgeNode: update } = await import('@/server/db/queries/knowledge-graph'));

    await pool.query(
      `CREATE TYPE "MasteryTier" AS ENUM ('establishing', 'familiar', 'solid', 'mastery')`,
    );
    for (const ddl of [
      `CREATE TABLE "KnowledgeNode" (id text PRIMARY KEY, label text NOT NULL, domain_key text NOT NULL UNIQUE, node_kind text NOT NULL DEFAULT 'leaf', mastery_threshold integer, broad_category text, field_hue text, wikidata_qid text, created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE "KnowledgeEdge" (id text PRIMARY KEY, child_domain_key text NOT NULL, parent_domain_key text NOT NULL, UNIQUE(child_domain_key, parent_domain_key))`,
      `CREATE TABLE "KnowledgeParentMastery" (id text PRIMARY KEY, user_id text NOT NULL, parent_domain_key text NOT NULL, mastered_at timestamptz NOT NULL, UNIQUE(user_id, parent_domain_key))`,
      `CREATE TABLE "KnowledgeLeafMastery" (id text PRIMARY KEY, user_id text NOT NULL, leaf_domain_key text NOT NULL, mastered_at timestamptz NOT NULL, UNIQUE(user_id, leaf_domain_key))`,
      `CREATE TABLE "DomainDepthEstimate" (id text PRIMARY KEY, domain_key text NOT NULL UNIQUE, sample_label text, manual_estimated_questions integer, generation_capped_at timestamptz)`,
      `CREATE TABLE "Question" (id text PRIMARY KEY, canonical_subcategory text)`,
      `CREATE TABLE "GeneratedQuestion" (id text PRIMARY KEY, canonical_subcategory text, domain_key text)`,
      `CREATE TABLE "MASTERY_EVENTS" (id text PRIMARY KEY, canonical_subcategory text)`,
      `CREATE TABLE "SkippedDailyQuestion" (id text PRIMARY KEY, canonical_subcategory text)`,
      `CREATE TABLE "CrafterDraftDecision" (id text PRIMARY KEY, domain text)`,
      `CREATE TABLE "PLAYER_MASTERY" (id text PRIMARY KEY, user_id text, canonical_subcategory text, tier "MasteryTier", total_points integer, lifetime_points_baseline integer, updated_at timestamptz)`,
      `CREATE TABLE "USER_DOMAIN_DIFFICULTY" (id text PRIMARY KEY, user_id text, canonical_subcategory text)`,
      `CREATE TABLE "PROFILE_DOMAIN_VISIBILITY" (id text PRIMARY KEY, user_id text, canonical_subcategory text, domain text)`,
      `CREATE TABLE "DeclaredInterest" (id text PRIMARY KEY, "userId" text, domain text, "isActive" boolean)`,
      `CREATE TABLE "USER_DOMAIN_EXCLUSIONS" (id text PRIMARY KEY, canonical_subcategory text)`,
      `CREATE TABLE "DAILY_REFINE_DECISION" (id text PRIMARY KEY, canonical_subcategory text)`,
      `CREATE TABLE "DomainRelation" (id text PRIMARY KEY, child_domain text, related_domain text)`,
      `CREATE TABLE "RetrievalDomainHealth" (id text PRIMARY KEY, domain text)`,
    ])
      await pool.query(ddl);
  });

  beforeEach(async () => {
    for (const table of [
      'KnowledgeNode',
      'KnowledgeEdge',
      'KnowledgeParentMastery',
      'KnowledgeLeafMastery',
      'DomainDepthEstimate',
      'Question',
      'GeneratedQuestion',
      'MASTERY_EVENTS',
      'SkippedDailyQuestion',
      'CrafterDraftDecision',
      'PLAYER_MASTERY',
      'USER_DOMAIN_DIFFICULTY',
      'PROFILE_DOMAIN_VISIBILITY',
      'DeclaredInterest',
      'USER_DOMAIN_EXCLUSIONS',
      'DAILY_REFINE_DECISION',
      'DomainRelation',
      'RetrievalDomainHealth',
    ])
      await pool.query(`TRUNCATE "${table}"`);
    await pool.query(
      `INSERT INTO "KnowledgeNode" (id, label, domain_key) VALUES ('n1', 'Old Name', 'old name')`,
    );
    await pool.query(
      `INSERT INTO "KnowledgeEdge" (id, child_domain_key, parent_domain_key) VALUES ('e1', 'old name', 'parent')`,
    );
    await pool.query(
      `INSERT INTO "KnowledgeParentMastery" VALUES ('p1', 'u1', 'old name', '2026-01-01T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO "KnowledgeLeafMastery" VALUES ('l1', 'u1', 'old name', '2026-01-01T00:00:00Z')`,
    );
    await pool.query(`INSERT INTO "Question" VALUES ('q1', 'Old Name')`);
    await pool.query(`INSERT INTO "GeneratedQuestion" VALUES ('g1', 'Old Name', 'old name')`);
    await pool.query(
      `INSERT INTO "DomainDepthEstimate" VALUES ('d1', 'old name', 'Old Name', 77, '2026-01-01T00:00:00Z')`,
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "UnexpectedDomainOwner"');
    await pool.query('DROP TABLE IF EXISTS "UnexpectedKeyOwner"');
    await pool.query('DROP FUNCTION IF EXISTS fail_question_rename() CASCADE');
    for (const table of [
      'RetrievalDomainHealth',
      'DomainRelation',
      'DAILY_REFINE_DECISION',
      'USER_DOMAIN_EXCLUSIONS',
      'DeclaredInterest',
      'PROFILE_DOMAIN_VISIBILITY',
      'USER_DOMAIN_DIFFICULTY',
      'PLAYER_MASTERY',
      'CrafterDraftDecision',
      'SkippedDailyQuestion',
      'MASTERY_EVENTS',
      'GeneratedQuestion',
      'Question',
      'KnowledgeLeafMastery',
      'DomainDepthEstimate',
      'KnowledgeParentMastery',
      'KnowledgeEdge',
      'KnowledgeNode',
    ])
      await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.query('DROP TYPE IF EXISTS "MasteryTier"');
    await pool.end();
  });

  it('renames the graph, corpus, and both earned award keys together', async () => {
    await pool.query(
      `INSERT INTO "KnowledgeParentMastery" VALUES ('p2', 'u1', 'new name', '2026-02-01T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO "KnowledgeLeafMastery" VALUES ('l2', 'u1', 'new name', '2026-02-01T00:00:00Z')`,
    );

    const result = await update({ id: 'n1', label: 'New Name', nodeKind: 'both' }, 'admin');
    expect(result).toMatchObject({
      ok: true,
      node: { label: 'New Name', domainKey: 'new name', nodeKind: 'both' },
    });
    expect((await pool.query(`SELECT child_domain_key FROM "KnowledgeEdge"`)).rows).toEqual([
      { child_domain_key: 'new name' },
    ]);
    expect((await pool.query(`SELECT canonical_subcategory FROM "Question"`)).rows).toEqual([
      { canonical_subcategory: 'New Name' },
    ]);
    expect(
      (await pool.query(`SELECT canonical_subcategory, domain_key FROM "GeneratedQuestion"`)).rows,
    ).toEqual([{ canonical_subcategory: 'New Name', domain_key: 'new name' }]);
    expect(
      (
        await pool.query(
          `SELECT domain_key, sample_label, manual_estimated_questions, generation_capped_at FROM "DomainDepthEstimate"`,
        )
      ).rows,
    ).toEqual([
      {
        domain_key: 'new name',
        sample_label: 'New Name',
        manual_estimated_questions: 77,
        generation_capped_at: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    for (const [table, column] of [
      ['KnowledgeParentMastery', 'parent_domain_key'],
      ['KnowledgeLeafMastery', 'leaf_domain_key'],
    ]) {
      const rows = (await pool.query(`SELECT "${column}" AS key, mastered_at FROM "${table}"`))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe('new name');
      expect(rows[0].mastered_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    }
  });

  it('updates a spelling without changing the key or earned awards', async () => {
    const result = await update({ id: 'n1', label: 'OLD NAME' }, 'admin');
    expect(result).toMatchObject({ ok: true, node: { label: 'OLD NAME', domainKey: 'old name' } });
    expect(
      (await pool.query(`SELECT canonical_subcategory FROM "Question"`)).rows[0]
        .canonical_subcategory,
    ).toBe('OLD NAME');
    expect(
      (await pool.query(`SELECT id, parent_domain_key FROM "KnowledgeParentMastery"`)).rows,
    ).toEqual([{ id: 'p1', parent_domain_key: 'old name' }]);
    expect(
      (await pool.query(`SELECT domain_key, sample_label FROM "DomainDepthEstimate"`)).rows,
    ).toEqual([{ domain_key: 'old name', sample_label: 'OLD NAME' }]);
  });

  it('aborts before writing when the label census finds an unhandled table', async () => {
    await pool.query(`CREATE TABLE "UnexpectedDomainOwner" (id text, domain text)`);
    await pool.query(`INSERT INTO "UnexpectedDomainOwner" VALUES ('x1', 'Old Name')`);
    try {
      expect(await update({ id: 'n1', label: 'New Name' }, 'admin')).toMatchObject({
        ok: false,
        reason: 'unhandled_tables',
        detail: ['UnexpectedDomainOwner.domain (1 rows)'],
      });
      expect((await pool.query(`SELECT label FROM "KnowledgeNode"`)).rows[0].label).toBe(
        'Old Name',
      );
      expect(
        (await pool.query(`SELECT child_domain_key FROM "KnowledgeEdge"`)).rows[0].child_domain_key,
      ).toBe('old name');
    } finally {
      await pool.query('DROP TABLE "UnexpectedDomainOwner"');
    }
  });

  it('aborts when another key-owned table would be stranded', async () => {
    await pool.query(`CREATE TABLE "UnexpectedKeyOwner" (id text, domain_key text)`);
    await pool.query(`INSERT INTO "UnexpectedKeyOwner" VALUES ('x1', 'old name')`);
    try {
      expect(await update({ id: 'n1', label: 'New Name' }, 'admin')).toMatchObject({
        ok: false,
        reason: 'unhandled_tables',
        detail: ['UnexpectedKeyOwner.domain_key (1 rows)'],
      });
      expect((await pool.query(`SELECT label FROM "KnowledgeNode"`)).rows[0].label).toBe(
        'Old Name',
      );
      expect(
        (await pool.query(`SELECT domain_key FROM "DomainDepthEstimate"`)).rows[0].domain_key,
      ).toBe('old name');
    } finally {
      await pool.query('DROP TABLE "UnexpectedKeyOwner"');
    }
  });

  it('does not discard either estimate when both old and new keys have one', async () => {
    await pool.query(
      `INSERT INTO "DomainDepthEstimate" VALUES ('d2', 'new name', 'New Name', 200, NULL)`,
    );
    expect(await update({ id: 'n1', label: 'New Name' }, 'admin')).toMatchObject({
      ok: false,
      reason: 'unhandled_tables',
      detail: ['DomainDepthEstimate.domain_key (old and new keys both have estimates)'],
    });
    expect(
      (
        await pool.query(
          `SELECT domain_key, manual_estimated_questions FROM "DomainDepthEstimate" ORDER BY domain_key`,
        )
      ).rows,
    ).toEqual([
      { domain_key: 'new name', manual_estimated_questions: 200 },
      { domain_key: 'old name', manual_estimated_questions: 77 },
    ]);
    expect((await pool.query(`SELECT label FROM "KnowledgeNode"`)).rows[0].label).toBe('Old Name');
  });

  it('surfaces a taken node key without changing the original node', async () => {
    await pool.query(
      `INSERT INTO "KnowledgeNode" (id, label, domain_key) VALUES ('n2', 'New Name', 'new name')`,
    );
    expect(await update({ id: 'n1', label: 'New Name' }, 'admin')).toMatchObject({
      ok: false,
      reason: 'domain_key_collision',
      existing: { id: 'n2', label: 'New Name' },
    });
    expect(
      (await pool.query(`SELECT label FROM "KnowledgeNode" WHERE id = 'n1'`)).rows[0].label,
    ).toBe('Old Name');
  });

  it('returns not_found for a missing node without writing anything', async () => {
    expect(await update({ id: 'missing', label: 'New Name' }, 'admin')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      (await pool.query(`SELECT label FROM "KnowledgeNode" WHERE id = 'n1'`)).rows[0].label,
    ).toBe('Old Name');
  });

  it('rolls back node, edges, and awards when question retargeting fails midway', async () => {
    await pool.query(`CREATE FUNCTION fail_question_rename() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced corpus failure'; END $$`);
    await pool.query(`CREATE TRIGGER fail_question_rename BEFORE UPDATE ON "Question"
      FOR EACH ROW EXECUTE FUNCTION fail_question_rename()`);
    try {
      await expect(update({ id: 'n1', label: 'New Name' }, 'admin')).rejects.toThrow(
        'forced corpus failure',
      );
      expect((await pool.query(`SELECT label, domain_key FROM "KnowledgeNode"`)).rows).toEqual([
        { label: 'Old Name', domain_key: 'old name' },
      ]);
      expect(
        (await pool.query(`SELECT child_domain_key FROM "KnowledgeEdge"`)).rows[0].child_domain_key,
      ).toBe('old name');
      expect(
        (await pool.query(`SELECT canonical_subcategory FROM "Question"`)).rows[0]
          .canonical_subcategory,
      ).toBe('Old Name');
      for (const [table, column] of [
        ['KnowledgeParentMastery', 'parent_domain_key'],
        ['KnowledgeLeafMastery', 'leaf_domain_key'],
      ])
        expect((await pool.query(`SELECT "${column}" AS key FROM "${table}"`)).rows[0].key).toBe(
          'old name',
        );
      expect(
        (await pool.query(`SELECT domain_key FROM "DomainDepthEstimate"`)).rows[0].domain_key,
      ).toBe('old name');
    } finally {
      await pool.query('DROP TRIGGER fail_question_rename ON "Question"');
      await pool.query('DROP FUNCTION fail_question_rename()');
    }
  });
});
