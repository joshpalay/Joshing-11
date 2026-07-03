/**
 * B-KNOWLEDGE-MERGE-01 — fold one territory into another, as a single admin
 * action ("Shakespeare" and "Shakespearean Drama" are the same territory —
 * combine them). This is the runtime port of scripts/merge-fragmented-domains.ts
 * (B-DOMAIN-FRAGMENT-MERGE-01), same semantics, one merge pair per call:
 *
 *   - retarget:    Question / GeneratedQuestion (+domain_key) / MASTERY_EVENTS /
 *                  SkippedDailyQuestion / CrafterDraftDecision rows move to the
 *                  target label.
 *   - consolidate: per-user unique tables (PLAYER_MASTERY sums points, max
 *                  tier; DeclaredInterest ORs isActive; the rest keep the
 *                  survivor row and drop the source).
 *   - drop cache:  DomainRelation / RetrievalDomainHealth rows for the source
 *                  are deleted and rebuild lazily.
 *   - census-abort: any OTHER populated table holding the source label aborts
 *                  BEFORE the transaction — silent partial merges are how
 *                  territories drift apart again.
 *
 * Plus the graph work the script deliberately excluded (KnowledgeNode is
 * authored — merging it IS the human act, and this action is the human):
 * the source node's edges re-point to the target (duplicates and self-edges
 * dropped), its frozen parent-mastery rows re-key, and the node is deleted.
 *
 * Whether two labels name the SAME scope is a human call — the caller (the
 * admin UI) is that human. Containment ("Shakespearean Tragedy" inside
 * "Shakespearean Drama") is the graph's job and must NOT come through here.
 */

import type { PoolClient } from 'pg';

import { pool } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

export type MergeDomainResult =
  | { ok: true; targetLabel: string; sourceLabels: string[]; retargeted: number; consolidated: number }
  | { ok: false; reason: 'unknown_node' | 'self_merge' | 'unhandled_tables'; detail?: string[] };

const RETARGET: Array<{ table: string; column: string }> = [
  { table: 'Question', column: 'canonical_subcategory' },
  { table: 'GeneratedQuestion', column: 'canonical_subcategory' },
  { table: 'MASTERY_EVENTS', column: 'canonical_subcategory' },
  { table: 'SkippedDailyQuestion', column: 'canonical_subcategory' },
  { table: 'CrafterDraftDecision', column: 'domain' },
];
const DROP_CACHE: Array<{ table: string; column: string }> = [
  { table: 'DomainRelation', column: 'child_domain' },
  { table: 'DomainRelation', column: 'related_domain' },
  { table: 'RetrievalDomainHealth', column: 'domain' },
];
const CONSOLIDATE_TABLES = new Set([
  'PLAYER_MASTERY',
  'DeclaredInterest',
  'USER_DOMAIN_DIFFICULTY',
  'PROFILE_DOMAIN_VISIBILITY',
  'USER_DOMAIN_EXCLUSIONS',
  'DAILY_REFINE_DECISION',
]);

// Schema order (masteryTierEnum) — the stronger tier survives a mastery merge.
const TIER_RANK: Record<string, number> = { establishing: 0, familiar: 1, solid: 2, mastery: 3 };

// Every (table, column) pair that can hold a domain label, from the live
// catalog so a future table can't silently escape the census. KnowledgeNode is
// excluded here because the graph side is handled explicitly below.
async function domainColumns(client: PoolClient): Promise<Array<{ table: string; column: string }>> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('canonical_subcategory', 'domain', 'child_domain', 'related_domain', 'label')
      AND table_name NOT IN ('KnowledgeNode')
    ORDER BY table_name, column_name
  `);
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

// Per-row rename with a unique-collision fallback (survivor's state stands).
async function renameOrDropRows(
  client: PoolClient,
  table: string,
  column: string,
  target: string,
  sources: string[],
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM "${table}" WHERE "${column}" = ANY($1)`,
    [sources],
  );
  for (const row of rows) {
    try {
      await client.query(`SAVEPOINT rename_row`);
      await client.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [target, row.id]);
      await client.query(`RELEASE SAVEPOINT rename_row`);
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      await client.query(`ROLLBACK TO SAVEPOINT rename_row`);
      await client.query(`DELETE FROM "${table}" WHERE id = $1`, [row.id]);
    }
  }
  return rows.length;
}

// The shared corpus-move core (used by merge AND rename follow-through):
// retargets the label-bearing rows, consolidates the per-user unique tables,
// drops caches. Runs INSIDE the caller's transaction; graph tables untouched.
async function applyCorpusRetarget(
  client: PoolClient,
  { target, targetKey, sources }: { target: string; targetKey: string; sources: string[] },
): Promise<{ retargeted: number; consolidated: number }> {
  let retargeted = 0;
  let consolidated = 0;

  for (const { table, column } of RETARGET) {
    const extra =
      table === 'GeneratedQuestion' ? `, "domain_key" = '${targetKey.replace(/'/g, "''")}'` : '';
    const res = await client.query(
      `UPDATE "${table}" SET "${column}" = $1${extra} WHERE "${column}" = ANY($2)`,
      [target, sources],
    );
    retargeted += res.rowCount ?? 0;
  }

  // PLAYER_MASTERY: unique (user_id, canonical_subcategory) — sum points into
  // an existing target row (max tier wins), else rename in place.
  const mastery = await client.query<{ id: string; user_id: string; tier: string }>(
    `SELECT id, user_id, tier FROM "PLAYER_MASTERY" WHERE canonical_subcategory = ANY($1)`,
    [sources],
  );
  for (const row of mastery.rows) {
    const existing = await client.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM "PLAYER_MASTERY" WHERE user_id = $1 AND canonical_subcategory = $2`,
      [row.user_id, target],
    );
    if (existing.rows.length > 0) {
      const strongerTier =
        (TIER_RANK[row.tier] ?? 0) > (TIER_RANK[existing.rows[0].tier] ?? 0)
          ? row.tier
          : existing.rows[0].tier;
      await client.query(
        `UPDATE "PLAYER_MASTERY" t SET
           total_points = t.total_points + s.total_points,
           lifetime_points_baseline = coalesce(t.lifetime_points_baseline, 0) + coalesce(s.lifetime_points_baseline, 0),
           tier = $3::"MasteryTier",
           updated_at = greatest(t.updated_at, s.updated_at)
         FROM "PLAYER_MASTERY" s WHERE t.id = $1 AND s.id = $2`,
        [existing.rows[0].id, row.id, strongerTier],
      );
      await client.query(`DELETE FROM "PLAYER_MASTERY" WHERE id = $1`, [row.id]);
    } else {
      await client.query(`UPDATE "PLAYER_MASTERY" SET canonical_subcategory = $1 WHERE id = $2`, [
        target,
        row.id,
      ]);
    }
    consolidated += 1;
  }

  // USER_DOMAIN_DIFFICULTY: survivor's ladder state stands on collision.
  const difficulty = await client.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM "USER_DOMAIN_DIFFICULTY" WHERE canonical_subcategory = ANY($1)`,
    [sources],
  );
  for (const row of difficulty.rows) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM "USER_DOMAIN_DIFFICULTY" WHERE user_id = $1 AND canonical_subcategory = $2`,
      [row.user_id, target],
    );
    if (existing.rows.length > 0) {
      await client.query(`DELETE FROM "USER_DOMAIN_DIFFICULTY" WHERE id = $1`, [row.id]);
    } else {
      await client.query(
        `UPDATE "USER_DOMAIN_DIFFICULTY" SET canonical_subcategory = $1 WHERE id = $2`,
        [target, row.id],
      );
    }
    consolidated += 1;
  }

  // PROFILE_DOMAIN_VISIBILITY: both label columns retarget; the survivor's
  // visibility choice stands on collision.
  const visibility = await client.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM "PROFILE_DOMAIN_VISIBILITY"
     WHERE canonical_subcategory = ANY($1) OR domain = ANY($1)`,
    [sources],
  );
  for (const row of visibility.rows) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM "PROFILE_DOMAIN_VISIBILITY"
       WHERE user_id = $1 AND (canonical_subcategory = $2 OR domain = $2) AND id <> $3`,
      [row.user_id, target, row.id],
    );
    if (existing.rows.length > 0) {
      await client.query(`DELETE FROM "PROFILE_DOMAIN_VISIBILITY" WHERE id = $1`, [row.id]);
    } else {
      await client.query(
        `UPDATE "PROFILE_DOMAIN_VISIBILITY" SET canonical_subcategory = $1, domain = $1 WHERE id = $2`,
        [target, row.id],
      );
    }
    consolidated += 1;
  }

  // DeclaredInterest: unique (userId, domain), camelCase columns — OR isActive
  // on collision.
  const declared = await client.query<{ id: string; userId: string }>(
    `SELECT id, "userId" FROM "DeclaredInterest" WHERE domain = ANY($1)`,
    [sources],
  );
  for (const row of declared.rows) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM "DeclaredInterest" WHERE "userId" = $1 AND domain = $2`,
      [row.userId, target],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE "DeclaredInterest" t SET "isActive" = t."isActive" OR s."isActive"
         FROM "DeclaredInterest" s WHERE t.id = $1 AND s.id = $2`,
        [existing.rows[0].id, row.id],
      );
      await client.query(`DELETE FROM "DeclaredInterest" WHERE id = $1`, [row.id]);
    } else {
      await client.query(`UPDATE "DeclaredInterest" SET domain = $1 WHERE id = $2`, [target, row.id]);
    }
    consolidated += 1;
  }

  consolidated += await renameOrDropRows(
    client, 'USER_DOMAIN_EXCLUSIONS', 'canonical_subcategory', target, sources,
  );
  consolidated += await renameOrDropRows(
    client, 'DAILY_REFINE_DECISION', 'canonical_subcategory', target, sources,
  );

  for (const { table, column } of DROP_CACHE) {
    await client.query(`DELETE FROM "${table}" WHERE "${column}" = ANY($1)`, [sources]);
  }

  return { retargeted, consolidated };
}

// Every distinct corpus spelling that folds onto `key`, across the
// label-bearing tables — the full set of labels a retarget must move.
async function collectSourceLabels(
  client: PoolClient,
  key: string,
  seed: string[],
): Promise<string[]> {
  const set = new Set<string>(seed);
  for (const { table, column } of await domainColumns(client)) {
    const { rows } = await client.query<{ label: string }>(
      `SELECT DISTINCT "${column}" AS label FROM "${table}" WHERE "${column}" IS NOT NULL`,
    );
    for (const r of rows) {
      if (domainKey(r.label) === key) set.add(r.label);
    }
  }
  return [...set];
}

// Census guard: any populated (table, column) holding a source label that the
// apply path doesn't know how to consolidate. Non-empty ⇒ abort BEFORE writes.
async function findUnhandledTables(client: PoolClient, sources: string[]): Promise<string[]> {
  const handled = new Set([
    ...RETARGET.map((t) => `${t.table}.${t.column}`),
    ...DROP_CACHE.map((t) => `${t.table}.${t.column}`),
  ]);
  const unhandled: string[] = [];
  for (const { table, column } of await domainColumns(client)) {
    if (handled.has(`${table}.${column}`) || CONSOLIDATE_TABLES.has(table)) continue;
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ANY($1)`,
      [sources],
    );
    if (Number(rows[0].n) > 0) unhandled.push(`${table}.${column} (${rows[0].n} rows)`);
  }
  return unhandled;
}

/**
 * Rename follow-through: a node's label changed, so the corpus rows that
 * carried the OLD label move to the new one (same retarget/consolidate
 * machinery as a merge, no graph changes — the node itself was already
 * renamed by updateKnowledgeNode). Without this, a rename strands the
 * territory's questions under the old label and the tree shows 0 Qs.
 */
export async function retargetRenamedDomain(
  input: { oldLabel: string; newLabel: string },
  actorUserId: string,
): Promise<
  | { ok: true; retargeted: number; consolidated: number }
  | { ok: false; reason: 'unhandled_tables'; detail: string[] }
> {
  const oldKey = domainKey(input.oldLabel);
  const client = await pool.connect();
  try {
    const sources = (await collectSourceLabels(client, oldKey, [input.oldLabel])).filter(
      (label) => label !== input.newLabel,
    );
    if (sources.length === 0) return { ok: true, retargeted: 0, consolidated: 0 };

    const unhandled = await findUnhandledTables(client, sources);
    if (unhandled.length > 0) return { ok: false, reason: 'unhandled_tables', detail: unhandled };

    await client.query('BEGIN');
    let result: { retargeted: number; consolidated: number };
    try {
      result = await applyCorpusRetarget(client, {
        target: input.newLabel,
        targetKey: domainKey(input.newLabel),
        sources,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.info('[knowledge-admin] rename corpus retargeted', {
      actorUserId,
      ...input,
      sources,
      ...result,
    });
    return { ok: true, ...result };
  } finally {
    client.release();
  }
}

export async function mergeDomainIntoTarget(
  input: { sourceDomainKey: string; targetDomainKey: string },
  actorUserId: string,
): Promise<MergeDomainResult> {
  if (input.sourceDomainKey === input.targetDomainKey) {
    return { ok: false, reason: 'self_merge' };
  }

  const client = await pool.connect();
  try {
    const nodes = await client.query<{ domain_key: string; label: string }>(
      `SELECT domain_key, label FROM "KnowledgeNode" WHERE domain_key = ANY($1)`,
      [[input.sourceDomainKey, input.targetDomainKey]],
    );
    const sourceNode = nodes.rows.find((n) => n.domain_key === input.sourceDomainKey);
    const targetNode = nodes.rows.find((n) => n.domain_key === input.targetDomainKey);
    if (!sourceNode || !targetNode) return { ok: false, reason: 'unknown_node' };
    const target = targetNode.label;

    // Source labels = every distinct corpus spelling that FOLDS onto the source
    // node (case/punctuation variants included), plus the node's own label.
    const sources = (await collectSourceLabels(client, input.sourceDomainKey, [sourceNode.label]))
      .filter((label) => label !== target);

    // Census + abort BEFORE any writes: a populated table we don't know how to
    // consolidate means this merge must be extended deliberately, not guessed.
    const unhandled = await findUnhandledTables(client, sources);
    if (unhandled.length > 0) {
      return { ok: false, reason: 'unhandled_tables', detail: unhandled };
    }

    const targetKey = input.targetDomainKey;
    let retargeted = 0;
    let consolidated = 0;

    await client.query('BEGIN');
    try {
      const moved = await applyCorpusRetarget(client, { target, targetKey, sources });
      retargeted = moved.retargeted;
      consolidated = moved.consolidated;

      // ── The graph side (this action IS the human authoring act) ──
      // Child edges: the source's children re-file under the target (skip
      // self-edges and duplicates — the unique index would reject them).
      await client.query(
        `DELETE FROM "KnowledgeEdge" e WHERE e.parent_domain_key = $1
           AND (e.child_domain_key = $2
                OR EXISTS (SELECT 1 FROM "KnowledgeEdge" t
                           WHERE t.parent_domain_key = $2 AND t.child_domain_key = e.child_domain_key))`,
        [input.sourceDomainKey, targetKey],
      );
      await client.query(
        `UPDATE "KnowledgeEdge" SET parent_domain_key = $2 WHERE parent_domain_key = $1`,
        [input.sourceDomainKey, targetKey],
      );
      // Parent edges: the source's own memberships transfer to the target.
      await client.query(
        `DELETE FROM "KnowledgeEdge" e WHERE e.child_domain_key = $1
           AND (e.parent_domain_key = $2
                OR EXISTS (SELECT 1 FROM "KnowledgeEdge" t
                           WHERE t.child_domain_key = $2 AND t.parent_domain_key = e.parent_domain_key))`,
        [input.sourceDomainKey, targetKey],
      );
      await client.query(
        `UPDATE "KnowledgeEdge" SET child_domain_key = $2 WHERE child_domain_key = $1`,
        [input.sourceDomainKey, targetKey],
      );
      // Frozen parent mastery re-keys; a player frozen on BOTH keeps the
      // target row (terminal either way, §B).
      const frozen = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM "KnowledgeParentMastery" WHERE parent_domain_key = $1`,
        [input.sourceDomainKey],
      );
      for (const row of frozen.rows) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM "KnowledgeParentMastery" WHERE user_id = $1 AND parent_domain_key = $2`,
          [row.user_id, targetKey],
        );
        if (existing.rows.length > 0) {
          await client.query(`DELETE FROM "KnowledgeParentMastery" WHERE id = $1`, [row.id]);
        } else {
          await client.query(
            `UPDATE "KnowledgeParentMastery" SET parent_domain_key = $2 WHERE id = $1`,
            [row.id, targetKey],
          );
        }
      }
      // The source node ceases to exist.
      await client.query(`DELETE FROM "KnowledgeNode" WHERE domain_key = $1`, [
        input.sourceDomainKey,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.info('[knowledge-admin] domain merged', {
      actorUserId,
      sourceDomainKey: input.sourceDomainKey,
      targetDomainKey: targetKey,
      sources,
      retargeted,
      consolidated,
    });
    return { ok: true, targetLabel: target, sourceLabels: sources, retargeted, consolidated };
  } finally {
    client.release();
  }
}
