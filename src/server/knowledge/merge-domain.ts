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

import type pg from 'pg';

import { pool } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import type { KnowledgeNodeRow, NodeResult, UpdateNodeInput } from '@/server/db/queries/knowledge-graph';

// Minimal query surface — a pg.Client (the merge CLI) and a pooled client both
// satisfy it, so the shared corpus/graph helpers below serve BOTH merge
// entry points (this module's node merge and domain-merges.ts's label batch).
type QueryClient = Pick<pg.ClientBase, 'query'>;

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
async function domainColumns(client: QueryClient): Promise<Array<{ table: string; column: string }>> {
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
  client: QueryClient,
  table: string,
  column: string,
  target: string,
  sources: string[],
  log?: string[],
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
    log?.push(`${table}: consolidated row ${row.id}`);
  }
  return rows.length;
}

// The shared corpus-move core (used by the node merge, the rename
// follow-through, AND domain-merges.ts's label batch — ONE copy of the logic
// that retargets a label across the ~10 tables that can hold one): retargets
// the label-bearing rows, consolidates the per-user unique tables, drops
// caches. Runs INSIDE the caller's transaction; graph tables untouched. The
// optional `log` collects the human-readable step lines the /admin/domains UI
// and merge CLI print.
export async function applyCorpusRetarget(
  client: QueryClient,
  { target, targetKey, sources }: { target: string; targetKey: string; sources: string[] },
  log?: string[],
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
    if (res.rowCount) log?.push(`${table}: retargeted ${res.rowCount}`);
  }

  // PLAYER_MASTERY: unique (user_id, canonical_subcategory) — sum points into
  // an existing target row (max tier wins), else rename in place.
  const mastery = await client.query<{
    id: string;
    user_id: string;
    canonical_subcategory: string;
    tier: string;
  }>(
    `SELECT id, user_id, canonical_subcategory, tier FROM "PLAYER_MASTERY"
     WHERE canonical_subcategory = ANY($1)`,
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
      log?.push(`PLAYER_MASTERY: summed ${row.canonical_subcategory} into ${target} (user ${row.user_id})`);
    } else {
      await client.query(`UPDATE "PLAYER_MASTERY" SET canonical_subcategory = $1 WHERE id = $2`, [
        target,
        row.id,
      ]);
      log?.push(`PLAYER_MASTERY: renamed for user ${row.user_id}`);
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
    log?.push(`USER_DOMAIN_DIFFICULTY: consolidated for user ${row.user_id}`);
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
    log?.push(`PROFILE_DOMAIN_VISIBILITY: consolidated for user ${row.user_id}`);
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
    log?.push(`DeclaredInterest: consolidated for user ${row.userId}`);
    consolidated += 1;
  }

  consolidated += await renameOrDropRows(
    client, 'USER_DOMAIN_EXCLUSIONS', 'canonical_subcategory', target, sources, log,
  );
  consolidated += await renameOrDropRows(
    client, 'DAILY_REFINE_DECISION', 'canonical_subcategory', target, sources, log,
  );

  for (const { table, column } of DROP_CACHE) {
    const res = await client.query(`DELETE FROM "${table}" WHERE "${column}" = ANY($1)`, [sources]);
    if (res.rowCount) log?.push(`${table}: dropped ${res.rowCount} cache rows (${column})`);
  }

  return { retargeted, consolidated };
}

export type GraphFoldOutcome = 'none' | 'merged_into_target_node' | 'rekeyed_source_node';

/**
 * The graph side of a merge, shared by BOTH merge entry points. When the source
 * key has a KnowledgeNode: its edges re-point to the target key (self-edges and
 * duplicates dropped first — the unique index would reject them) and its frozen
 * parent-mastery rows re-key (frozen on both keeps the target row, terminal
 * either way). Then:
 *  - target node EXISTS  → the source node is deleted (classic node merge);
 *  - target node ABSENT  → the source node is re-keyed/renamed to the target
 *    (label folding used to orphan the node here — the authored structure now
 *    follows the label instead of pointing at an emptied territory).
 * No source node → nothing to do. Runs INSIDE the caller's transaction.
 */
export async function applyGraphFold(
  client: QueryClient,
  { sourceKey, targetKey, targetLabel }: { sourceKey: string; targetKey: string; targetLabel: string },
  log?: string[],
): Promise<GraphFoldOutcome> {
  if (sourceKey === targetKey) return 'none';
  const nodes = await client.query<{ domain_key: string }>(
    `SELECT domain_key FROM "KnowledgeNode" WHERE domain_key = ANY($1)`,
    [[sourceKey, targetKey]],
  );
  const hasSource = nodes.rows.some((n) => n.domain_key === sourceKey);
  if (!hasSource) return 'none';
  const hasTarget = nodes.rows.some((n) => n.domain_key === targetKey);

  // Child edges: the source's children re-file under the target (skip
  // self-edges and duplicates — the unique index would reject them).
  await client.query(
    `DELETE FROM "KnowledgeEdge" e WHERE e.parent_domain_key = $1
       AND (e.child_domain_key = $2
            OR EXISTS (SELECT 1 FROM "KnowledgeEdge" t
                       WHERE t.parent_domain_key = $2 AND t.child_domain_key = e.child_domain_key))`,
    [sourceKey, targetKey],
  );
  await client.query(
    `UPDATE "KnowledgeEdge" SET parent_domain_key = $2 WHERE parent_domain_key = $1`,
    [sourceKey, targetKey],
  );
  // Parent edges: the source's own memberships transfer to the target.
  await client.query(
    `DELETE FROM "KnowledgeEdge" e WHERE e.child_domain_key = $1
       AND (e.parent_domain_key = $2
            OR EXISTS (SELECT 1 FROM "KnowledgeEdge" t
                       WHERE t.child_domain_key = $2 AND t.parent_domain_key = e.parent_domain_key))`,
    [sourceKey, targetKey],
  );
  await client.query(
    `UPDATE "KnowledgeEdge" SET child_domain_key = $2 WHERE child_domain_key = $1`,
    [sourceKey, targetKey],
  );

  // Frozen parent mastery re-keys; a player frozen on BOTH keeps the target
  // row (terminal either way, §B).
  const frozen = await client.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM "KnowledgeParentMastery" WHERE parent_domain_key = $1`,
    [sourceKey],
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

  if (hasTarget) {
    // The source node ceases to exist.
    await client.query(`DELETE FROM "KnowledgeNode" WHERE domain_key = $1`, [sourceKey]);
    log?.push(`KnowledgeNode: folded graph node into existing "${targetLabel}" node`);
    return 'merged_into_target_node';
  }
  // No target node: the authored node follows the surviving label.
  await client.query(
    `UPDATE "KnowledgeNode" SET label = $2, domain_key = $3 WHERE domain_key = $1`,
    [sourceKey, targetLabel, targetKey],
  );
  log?.push(`KnowledgeNode: re-keyed graph node to "${targetLabel}" (structure kept)`);
  return 'rekeyed_source_node';
}

// Every distinct corpus spelling that folds onto `key`, across the
// label-bearing tables — the full set of labels a retarget must move.
async function collectSourceLabels(
  client: QueryClient,
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
async function findUnhandledTables(client: QueryClient, sources: string[]): Promise<string[]> {
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

// Label census does not see rows keyed by the normalized domain key. A rename
// handles the known key owners below; reject any newly introduced key owner
// with data before changing the graph, rather than silently stranding it.
async function findUnhandledRenameKeyTables(client: QueryClient, oldKey: string): Promise<string[]> {
  const handled = new Set([
    'KnowledgeNode.domain_key',
    'KnowledgeEdge.child_domain_key',
    'KnowledgeEdge.parent_domain_key',
    'KnowledgeParentMastery.parent_domain_key',
    'KnowledgeLeafMastery.leaf_domain_key',
    'GeneratedQuestion.domain_key',
    'DomainDepthEstimate.domain_key',
  ]);
  const columns = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('domain_key', 'child_domain_key', 'parent_domain_key', 'leaf_domain_key')
    ORDER BY table_name, column_name
  `);
  const unhandled: string[] = [];
  for (const { table_name: table, column_name: column } of columns.rows) {
    if (handled.has(`${table}.${column}`)) continue;
    const quotedTable = `"${table.replace(/"/g, '""')}"`;
    const rows = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${quotedTable} WHERE "${column}" = $1`,
      [oldKey],
    );
    if (Number(rows.rows[0].n) > 0) {
      unhandled.push(`${table}.${column} (${rows.rows[0].n} rows)`);
    }
  }
  return unhandled;
}

const NODE_COLUMNS = `id, label, domain_key AS "domainKey", node_kind AS "nodeKind",
  mastery_threshold AS "masteryThreshold", broad_category AS "broadCategory",
  field_hue AS "fieldHue", wikidata_qid AS "wikidataQid", created_at AS "createdAt"`;

// A rename is the same authored territory under a new key. Keep both earned
// award ledgers, retaining the earlier crossing if the destination already has
// a row for that player. This moves awards only; answer-based point accounting
// remains in applyCorpusRetarget.
async function rekeyRenameAwards(client: QueryClient, oldKey: string, nextKey: string): Promise<void> {
  for (const { table, column } of [
    { table: 'KnowledgeParentMastery', column: 'parent_domain_key' },
    { table: 'KnowledgeLeafMastery', column: 'leaf_domain_key' },
  ]) {
    await client.query(
      `UPDATE "${table}" target SET mastered_at = least(target.mastered_at, source.mastered_at)
       FROM "${table}" source
       WHERE source."${column}" = $1 AND target."${column}" = $2
         AND target.user_id = source.user_id`,
      [oldKey, nextKey],
    );
    await client.query(
      `DELETE FROM "${table}" source WHERE source."${column}" = $1
       AND EXISTS (SELECT 1 FROM "${table}" target
                   WHERE target."${column}" = $2 AND target.user_id = source.user_id)`,
      [oldKey, nextKey],
    );
    await client.query(`UPDATE "${table}" SET "${column}" = $2 WHERE "${column}" = $1`, [
      oldKey, nextKey,
    ]);
  }
}

/** Change a node, its edges, corpus labels, and earned awards in one transaction. */
export async function updateKnowledgeNodeAtomically(
  input: UpdateNodeInput,
  actorUserId: string,
): Promise<NodeResult> {
  const client = await pool.connect();
  let inTransaction = false;
  let nextKey: string | undefined;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const current = await client.query<KnowledgeNodeRow>(
      `SELECT ${NODE_COLUMNS} FROM "KnowledgeNode" WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    const node = current.rows[0];
    if (!node) return { ok: false, reason: 'not_found' };

    const nextLabel = input.label?.trim() || node.label;
    nextKey = domainKey(nextLabel);
    if (nextKey !== node.domainKey) {
      const collision = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS} FROM "KnowledgeNode" WHERE domain_key = $1`,
        [nextKey],
      );
      if (collision.rows[0]) {
        return { ok: false, reason: 'domain_key_collision', existing: collision.rows[0] };
      }
    }

    let sources: string[] = [];
    if (nextLabel !== node.label) {
      sources = (await collectSourceLabels(client, node.domainKey, [node.label]))
        .filter((label) => label !== nextLabel);
      const unhandled = await findUnhandledTables(client, sources);
      if (unhandled.length > 0) {
        return { ok: false, reason: 'unhandled_tables', detail: unhandled };
      }
    }
    if (nextKey !== node.domainKey) {
      const unhandled = await findUnhandledRenameKeyTables(client, node.domainKey);
      if (unhandled.length > 0) {
        return { ok: false, reason: 'unhandled_tables', detail: unhandled };
      }
      const estimates = await client.query<{ domain_key: string }>(
        `SELECT domain_key FROM "DomainDepthEstimate" WHERE domain_key = ANY($1) FOR UPDATE`,
        [[node.domainKey, nextKey]],
      );
      if (estimates.rows.length === 2) {
        return {
          ok: false,
          reason: 'unhandled_tables',
          detail: ['DomainDepthEstimate.domain_key (old and new keys both have estimates)'],
        };
      }
    }

    const changed = await client.query<KnowledgeNodeRow>(
      `UPDATE "KnowledgeNode" SET label = $2, domain_key = $3, node_kind = $4,
         mastery_threshold = $5, broad_category = $6, field_hue = $7
       WHERE id = $1 RETURNING ${NODE_COLUMNS}`,
      [input.id, nextLabel, nextKey, input.nodeKind ?? node.nodeKind,
        input.masteryThreshold === undefined ? node.masteryThreshold : input.masteryThreshold,
        input.broadCategory === undefined ? node.broadCategory : input.broadCategory,
        input.fieldHue === undefined ? node.fieldHue : input.fieldHue],
    );

    if (nextKey !== node.domainKey) {
      await client.query(
        `UPDATE "KnowledgeEdge" SET child_domain_key = $2 WHERE child_domain_key = $1`,
        [node.domainKey, nextKey],
      );
      await client.query(
        `UPDATE "KnowledgeEdge" SET parent_domain_key = $2 WHERE parent_domain_key = $1`,
        [node.domainKey, nextKey],
      );
      await rekeyRenameAwards(client, node.domainKey, nextKey);
    }
    if (nextLabel !== node.label || nextKey !== node.domainKey) {
      await client.query(
        `UPDATE "DomainDepthEstimate" SET domain_key = $2, sample_label = $3 WHERE domain_key = $1`,
        [node.domainKey, nextKey, nextLabel],
      );
    }
    if (sources.length > 0) {
      await applyCorpusRetarget(client, { target: nextLabel, targetKey: nextKey, sources });
    }

    await client.query('COMMIT');
    inTransaction = false;
    console.info('[knowledge-admin] node updated', {
      actorUserId,
      id: input.id,
      renamed: nextKey !== node.domainKey ? { from: node.domainKey, to: nextKey } : false,
    });
    return { ok: true, node: changed.rows[0] };
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK');
      inTransaction = false;
    }
    if ((err as { code?: string }).code === '23505' && nextKey) {
      if ((err as { constraint?: string }).constraint === 'DomainDepthEstimate_domain_key') {
        return {
          ok: false,
          reason: 'unhandled_tables',
          detail: ['DomainDepthEstimate.domain_key (new key gained an estimate during rename)'],
        };
      }
      const collision = await client.query<KnowledgeNodeRow>(
        `SELECT ${NODE_COLUMNS} FROM "KnowledgeNode" WHERE domain_key = $1`,
        [nextKey],
      );
      if (collision.rows[0]) {
        return { ok: false, reason: 'domain_key_collision', existing: collision.rows[0] };
      }
    }
    throw err;
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
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
      // Both nodes exist (checked above), so this is always the classic node
      // merge: edges re-point, frozen parent mastery re-keys, source node dies.
      await applyGraphFold(client, {
        sourceKey: input.sourceDomainKey,
        targetKey,
        targetLabel: target,
      });

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
