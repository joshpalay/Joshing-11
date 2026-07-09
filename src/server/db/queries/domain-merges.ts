import type pg from 'pg';

import { pool } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { applyCorpusRetarget, applyGraphFold } from '@/server/knowledge/merge-domain';

/**
 * The shared applier behind BOTH the ops CLI (scripts/merge-fragmented-domains.ts)
 * and the admin decision UI (/admin/domains). The actual row-moving logic lives
 * in ONE place — merge-domain.ts's applyCorpusRetarget + applyGraphFold — shared
 * with the knowledge tree's "Merge into…" so the two merge surfaces can never
 * drift apart again (this module used to carry a verbatim duplicate of the
 * corpus transaction, and no graph handling at all). What stays here is the
 * batch shape: multi-spec normalization, the read-only census/preview, and the
 * unhandled-table abort guard.
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
 *
 * Corpus + graph, via the ONE shared engine (merge-domain.ts): the corpus move
 * (retarget/consolidate/drop-cache) runs through applyCorpusRetarget, then the
 * graph follows through applyGraphFold — if a folded label's key has an authored
 * KnowledgeNode, its edges/frozen-mastery re-point and the node merges into the
 * target's node (or is re-keyed to the surviving label when the target has
 * none). Label folding used to leave that node orphaned on an emptied label —
 * the historical drift between this path and the tree's "Merge into…".
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

      const moved = await applyCorpusRetarget(client, { target, targetKey, sources }, log);
      retargeted += moved.retargeted;

      // Graph follow-through: fold each distinct source KEY's node (if any).
      for (const sourceKey of new Set(sources.map((label) => domainKey(label)))) {
        await applyGraphFold(client, { sourceKey, targetKey, targetLabel: target }, log);
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
