import type pg from 'pg';

import { pool } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

/**
 * The shared applier behind BOTH the ops CLI (scripts/merge-fragmented-domains.ts)
 * and the admin decision UI (/admin/domains). It ports the CLI's original
 * transaction verbatim so there is exactly ONE copy of the logic that retargets a
 * domain label across the ~10 tables that can hold one — a duplicated copy would
 * drift, and this routine mutates prod. See the CLI header for the per-table
 * semantics; the census/RETARGET/DROP_CACHE/CONSOLIDATE maps below are the source
 * of truth both callers reuse.
 *
 * Client-agnostic on purpose: the CLI passes its own `pg.Client` (DIRECT_URL); the
 * API passes a pooled client. Both expose `.query()` (pg.ClientBase). Neither the
 * preview nor the apply opens/closes the connection — the caller owns its lifecycle.
 * Human-readable step lines are RETURNED in `log` (never console.log'd) so the CLI
 * can print them and the API can ship them back to the browser.
 */

export type DomainMergeSpec = { target: string; sources: string[] };

export type MergeCensusRow = { table: string; column: string; label: string; rows: number };

export type MergePreview = {
  /** Every (table, column, source-label) that currently holds rows. */
  census: MergeCensusRow[];
  /** Census rows in tables the apply path does NOT know how to consolidate. */
  unhandled: MergeCensusRow[];
  /** True when there is something to merge and nothing unhandled — safe to apply. */
  ok: boolean;
  /** Reason when !ok: nothing to do vs. an unhandled table that would abort. */
  reason?: 'no_source_rows' | 'unhandled_tables';
};

export type MergeApplyResult =
  | { ok: true; retargeted: number; log: string[] }
  | { ok: false; reason: 'no_source_rows' | 'unhandled_tables'; unhandled: MergeCensusRow[] };

// A pg.Client and a pooled client both satisfy this — the CLI and API each supply
// their own, and neither the preview nor apply manages the connection lifecycle.
type QueryClient = Pick<pg.ClientBase, 'query'>;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Drop obvious no-ops: a source equal to its own target, and empty specs. Keeps
// the census/transaction from doing pointless work (and from renaming a row to
// the value it already holds).
export function normalizeMergeSpecs(merges: DomainMergeSpec[]): DomainMergeSpec[] {
  const out: DomainMergeSpec[] = [];
  for (const m of merges) {
    const target = m.target.trim();
    const sources = Array.from(
      new Set(m.sources.map((s) => s.trim()).filter((s) => s && s !== target)),
    );
    if (target && sources.length > 0) out.push({ target, sources });
  }
  return out;
}

// Every (table, column) that can hold a domain label, discovered from the live
// catalog so a future table can't silently escape the census.
async function domainColumns(client: QueryClient): Promise<Array<{ table: string; column: string }>> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('canonical_subcategory', 'domain', 'child_domain', 'related_domain', 'label')
      AND table_name NOT IN ('KnowledgeNode')  -- graph labels are authored, never auto-merged
    ORDER BY table_name, column_name
  `);
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

export async function censusDomainLabels(
  client: QueryClient,
  labels: string[],
): Promise<MergeCensusRow[]> {
  const out: MergeCensusRow[] = [];
  if (labels.length === 0) return out;
  for (const { table, column } of await domainColumns(client)) {
    const { rows } = await client.query<{ label: string; n: string }>(
      `SELECT "${column}" AS label, count(*) AS n FROM "${table}"
       WHERE "${column}" = ANY($1) GROUP BY 1`,
      [labels],
    );
    for (const r of rows) out.push({ table, column, label: r.label, rows: Number(r.n) });
  }
  return out;
}

// Tables the apply path knows how to handle, by semantics. Anything else that the
// census finds populated for a source label ABORTS (silent partial merges are how
// territories drift back apart).
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

/** Census rows in tables the apply path can't consolidate — these abort an apply. */
export function unhandledCensusRows(census: MergeCensusRow[]): MergeCensusRow[] {
  const handled = new Set([
    ...RETARGET.map((t) => `${t.table}.${t.column}`),
    ...DROP_CACHE.map((t) => `${t.table}.${t.column}`),
  ]);
  return census.filter(
    (r) => !handled.has(`${r.table}.${r.column}`) && !CONSOLIDATE_TABLES.has(r.table),
  );
}

// Schema order (masteryTierEnum) — the stronger tier survives a mastery merge.
const TIER_RANK: Record<string, number> = { establishing: 0, familiar: 1, solid: 2, mastery: 3 };

// Per-row rename with a unique-collision fallback: when the user already has an
// equivalent row for the target label, the survivor's state stands and the source
// row is dropped. Fits any per-user cache/ledger whose unique key includes the
// label column (USER_DOMAIN_EXCLUSIONS, DAILY_REFINE_DECISION).
async function renameOrDropRows(
  client: QueryClient,
  table: string,
  column: string,
  target: string,
  sources: string[],
  log: string[],
): Promise<void> {
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
    log.push(`${table}: consolidated row ${row.id}`);
  }
}

/**
 * Read-only dry-run: census the source labels and flag any table the apply path
 * can't consolidate. Mutates nothing. `ok` is true only when there is something
 * to merge AND nothing unhandled.
 */
export async function previewDomainMerges(
  client: QueryClient,
  merges: DomainMergeSpec[],
): Promise<MergePreview> {
  const specs = normalizeMergeSpecs(merges);
  const allSources = specs.flatMap((m) => m.sources);
  const rows = await censusDomainLabels(client, allSources);
  if (rows.length === 0) {
    return { census: [], unhandled: [], ok: false, reason: 'no_source_rows' };
  }
  const unhandled = unhandledCensusRows(rows);
  if (unhandled.length > 0) {
    return { census: rows, unhandled, ok: false, reason: 'unhandled_tables' };
  }
  return { census: rows, unhandled: [], ok: true };
}

/**
 * Apply the merge map in ONE transaction. Aborts (rolls back, no partial merge) if
 * any source label lives in a table this routine can't consolidate. Idempotent:
 * a second run finds no source rows and returns { ok:false, reason:'no_source_rows' }.
 * Ported verbatim from scripts/merge-fragmented-domains.ts:run().
 */
export async function applyDomainMerges(
  client: QueryClient,
  merges: DomainMergeSpec[],
): Promise<MergeApplyResult> {
  const specs = normalizeMergeSpecs(merges);
  const allSources = specs.flatMap((m) => m.sources);
  const rows = await censusDomainLabels(client, allSources);
  if (rows.length === 0) {
    return { ok: false, reason: 'no_source_rows', unhandled: [] };
  }
  const unhandled = unhandledCensusRows(rows);
  if (unhandled.length > 0) {
    return { ok: false, reason: 'unhandled_tables', unhandled };
  }

  const log: string[] = [];
  let retargeted = 0;

  await client.query('BEGIN');
  try {
    for (const { target, sources } of specs) {
      const targetKey = domainKey(target);

      for (const { table, column } of RETARGET) {
        const extra =
          table === 'GeneratedQuestion' ? `, "domain_key" = ${sqlLiteral(targetKey)}` : '';
        const res = await client.query(
          `UPDATE "${table}" SET "${column}" = $1${extra} WHERE "${column}" = ANY($2)`,
          [target, sources],
        );
        if (res.rowCount) {
          retargeted += res.rowCount;
          log.push(`${table}: retargeted ${res.rowCount}`);
        }
      }

      // PLAYER_MASTERY: unique (user_id, canonical_subcategory). Sum a source row
      // into an existing target row (max tier wins), else rename in place.
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
          log.push(`PLAYER_MASTERY: summed ${row.canonical_subcategory} into ${target} (user ${row.user_id})`);
        } else {
          await client.query(`UPDATE "PLAYER_MASTERY" SET canonical_subcategory = $1 WHERE id = $2`, [
            target,
            row.id,
          ]);
          log.push(`PLAYER_MASTERY: renamed for user ${row.user_id}`);
        }
      }

      // USER_DOMAIN_DIFFICULTY: unique (user_id, canonical_subcategory) — an
      // adaptive-difficulty cache. Rename to the target unless the user already has
      // a target row; then the survivor's ladder state stands and the source drops.
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
        log.push(`USER_DOMAIN_DIFFICULTY: consolidated for user ${row.user_id}`);
      }

      // PROFILE_DOMAIN_VISIBILITY: unique per (user_id, canonical_subcategory) AND
      // (user_id, domain) — both columns carry the label, both retarget. On
      // collision the survivor's visibility choice stands.
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
        log.push(`PROFILE_DOMAIN_VISIBILITY: consolidated for user ${row.user_id}`);
      }

      // DeclaredInterest: unique (userId, domain) — NB camelCase columns on this
      // older table. OR isActive on collision.
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
        log.push(`DeclaredInterest: consolidated for user ${row.userId}`);
      }

      await renameOrDropRows(client, 'USER_DOMAIN_EXCLUSIONS', 'canonical_subcategory', target, sources, log);
      await renameOrDropRows(client, 'DAILY_REFINE_DECISION', 'canonical_subcategory', target, sources, log);

      for (const { table, column } of DROP_CACHE) {
        const res = await client.query(`DELETE FROM "${table}" WHERE "${column}" = ANY($1)`, [sources]);
        if (res.rowCount) log.push(`${table}: dropped ${res.rowCount} cache rows (${column})`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  return { ok: true, retargeted, log };
}

// ─── Pool-backed wrappers for the API (the CLI supplies its own client) ──────────

/** Acquire a pooled client, run the read-only preview, always release. */
export async function runDomainMergePreview(merges: DomainMergeSpec[]): Promise<MergePreview> {
  const client = await pool.connect();
  try {
    return await previewDomainMerges(client, merges);
  } finally {
    client.release();
  }
}

/** Acquire a pooled client, run the transactional apply, always release. */
export async function runDomainMergeApply(merges: DomainMergeSpec[]): Promise<MergeApplyResult> {
  const client = await pool.connect();
  try {
    return await applyDomainMerges(client, merges);
  } finally {
    client.release();
  }
}
