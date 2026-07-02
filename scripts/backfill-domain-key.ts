/**
 * B-DOMAIN-KEY-NORMALIZE-01 — repair GeneratedQuestion.domain_key.
 *
 * The bank lookup (pickBankSource) matches on domainKey(requestedDomain); the
 * documented invariant (schema.ts, migration 0074) is that every pooled row
 * stores domain_key = domainKey(canonical_subcategory). On this database the
 * 0074 TS-side backfill never fully ran: ~49% of rows have a NULL domain_key and
 * a further stratum carry a STALE key (folded before the colon rule was added)
 * or a REQUEST-derived key that diverges from the row's own display. All three
 * classes fall back to exact display-string matching, so spelling/case/connector
 * variants of a request miss existing stock and pay a fresh Sonnet generation.
 *
 * This repair recomputes domain_key = domainKey(canonical_subcategory) for every
 * row where it differs, using the SAME domainKey() the lookup uses (imported, not
 * re-implemented — 0074 notes the fold cannot be mirrored in SQL). It touches
 * ONLY the comparison key: never canonical_subcategory (the display), never
 * question content, never fact_key / is_duplicate.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-key.ts            # dry-run report
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-key.ts --print-sql # emit UPDATEs for the Supabase SQL editor
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-key.ts --apply     # write, in one transaction
 *
 * Idempotent: re-running after --apply reports 0 changes.
 */
import pg from 'pg';

import { domainKey } from '../src/lib/knowledge/domain-key';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const PRINT_SQL = process.argv.includes('--print-sql');

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type Row = { canonical_subcategory: string; domain_key: string | null; rows: number; servable: number };

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // One row per (display, stored key) so we can see every mis-keyed stratum.
    const { rows } = await client.query<Row>(`
      SELECT canonical_subcategory,
             domain_key,
             count(*)::int AS rows,
             count(*) FILTER (WHERE fact_key IS NOT NULL)::int AS servable
      FROM "GeneratedQuestion"
      GROUP BY canonical_subcategory, domain_key
    `);

    // Group the strata by the CORRECT key each display should have.
    const byWantedKey = new Map<string, { displays: Set<string>; strata: Row[] }>();
    let rowsToChange = 0;
    let servableToRecover = 0;
    const displaysNeedingChange = new Map<string, Row[]>();

    for (const r of rows) {
      const want = domainKey(r.canonical_subcategory);
      const entry = byWantedKey.get(want) ?? { displays: new Set(), strata: [] };
      entry.displays.add(r.canonical_subcategory);
      entry.strata.push(r);
      byWantedKey.set(want, entry);

      if (r.domain_key !== want) {
        rowsToChange += r.rows;
        servableToRecover += r.servable;
        const list = displaysNeedingChange.get(r.canonical_subcategory) ?? [];
        list.push(r);
        displaysNeedingChange.set(r.canonical_subcategory, list);
      }
    }

    // SAFETY: a wanted key produced by TWO OR MORE distinct displays is a merge.
    // These are expected only for true variants (case / & vs and). Surface every
    // one so a genuine false-merge (two different topics) can't slip through.
    const merges = [...byWantedKey.entries()].filter(([, v]) => v.displays.size > 1);

    console.log('\n=== domain_key repair — DRY RUN ===');
    console.log(`rows total:            ${rows.reduce((n, r) => n + r.rows, 0)}`);
    console.log(`rows to re-key:        ${rowsToChange}`);
    console.log(`servable rows re-keyed:${servableToRecover}`);
    console.log(`distinct displays touched: ${displaysNeedingChange.size}`);

    console.log(`\n--- key merges (>1 display → same key): ${merges.length} ---`);
    console.log('    (verify each is a true variant, NOT two different topics)');
    for (const [key, v] of merges.sort((a, b) => b[1].displays.size - a[1].displays.size)) {
      console.log(`  "${key}"  <=  ${[...v.displays].map((d) => JSON.stringify(d)).join('  |  ')}`);
    }

    if (PRINT_SQL) {
      console.log('\n--- SQL (paste into Supabase SQL editor) ---');
      console.log('BEGIN;');
      for (const [display, strata] of displaysNeedingChange) {
        const want = domainKey(display);
        const servable = strata.reduce((n, s) => n + s.servable, 0);
        console.log(
          `UPDATE "GeneratedQuestion" SET domain_key = ${sqlLiteral(want)} ` +
            `WHERE canonical_subcategory = ${sqlLiteral(display)} ` +
            `AND domain_key IS DISTINCT FROM ${sqlLiteral(want)};  -- ${servable} servable`,
        );
      }
      console.log('COMMIT;');
    }

    if (APPLY) {
      console.log('\n--- APPLYING ---');
      await client.query('BEGIN');
      let changed = 0;
      for (const [display] of displaysNeedingChange) {
        const want = domainKey(display);
        const res = await client.query(
          `UPDATE "GeneratedQuestion" SET domain_key = $1
           WHERE canonical_subcategory = $2 AND domain_key IS DISTINCT FROM $1`,
          [want, display],
        );
        changed += res.rowCount ?? 0;
      }
      await client.query('COMMIT');
      console.log(`updated ${changed} rows.`);
    } else {
      console.log('\n(no writes — pass --apply to execute, or --print-sql to emit SQL)');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* not in a txn */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
