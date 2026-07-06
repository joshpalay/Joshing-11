/**
 * Repair GeneratedQuestion.fact_key on legacy rows (Josh's repeated-question
 * report, 2026-07-06).
 *
 * fact_key is the dedup handle: getRecentFactKeys / pickBankSource / the
 * generator's avoid-list all key on it, and a NULL fact_key is INVISIBLE to every
 * one of them — so a fact answered via a null-keyed row keeps getting regenerated
 * and re-surfaced (the "Star Trek flute three times" case). ~23% of the bank
 * (303/1303 rows at time of writing) carries a NULL fact_key from before fact_key
 * population was reliable; new generation (last 7 days) sets it correctly.
 *
 * Every null row still carries subject_entity AND answer, so we rebuild the same
 * shape the generator emits — "<domain> <subject> <answer>" → normalizeFactKey —
 * DETERMINISTICALLY (no LLM), using the SAME normalizer the live path uses
 * (imported, not re-implemented). This is a best-effort floor: it makes the legacy
 * rows dedup-VISIBLE (registered when answered, excluded from bank re-serve). The
 * structural cross-surface fix — dedup on ANSWERED facts with a normalized-text
 * fallback — is the follow-up (part B); this backfill stands on its own.
 *
 * Touches ONLY fact_key, ONLY where it is currently NULL and a key is derivable.
 * Never rewrites an existing key, question content, subject_entity, or answer.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-fact-key.ts             # dry-run report
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-fact-key.ts --print-sql # emit UPDATEs for the SQL editor
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-fact-key.ts --apply      # write, in one transaction
 *
 * Idempotent: re-running after --apply reports 0 changes (the rows are no longer NULL).
 */
import pg from 'pg';

import { normalizeFactKey } from '../src/server/questions/fact-key';

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

type Row = {
  id: string;
  canonical_subcategory: string | null;
  subject_entity: string | null;
  answer: string | null;
};

/** The same "<domain> <subject> <answer>" shape the generator emits, slugged. */
function deriveFactKey(r: Row): string | null {
  const parts = [r.canonical_subcategory, r.subject_entity, r.answer]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return normalizeFactKey(parts.join(' '));
}

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<Row>(`
      SELECT id, canonical_subcategory, subject_entity, answer
      FROM "GeneratedQuestion"
      WHERE fact_key IS NULL
    `);

    const derivable: Array<{ id: string; key: string; label: string }> = [];
    let underivable = 0;
    for (const r of rows) {
      const key = deriveFactKey(r);
      if (!key) {
        underivable += 1;
        continue;
      }
      derivable.push({
        id: r.id,
        key,
        label: `${(r.canonical_subcategory ?? '?').slice(0, 24)} | ${(r.subject_entity ?? '?').slice(0, 22)} → ${(r.answer ?? '?').slice(0, 20)}`,
      });
    }

    console.log('\n=== fact_key backfill — DRY RUN ===');
    console.log(`null fact_key rows:    ${rows.length}`);
    console.log(`derivable (will set):  ${derivable.length}`);
    console.log(`underivable (skipped): ${underivable}`);
    console.log('\n--- sample of proposed keys ---');
    for (const d of derivable.slice(0, 12)) {
      console.log(`  ${d.key}\n      ${d.label}`);
    }

    if (PRINT_SQL) {
      console.log('\n--- SQL (paste into Supabase SQL editor) ---');
      console.log('BEGIN;');
      for (const d of derivable) {
        console.log(
          `UPDATE "GeneratedQuestion" SET fact_key = ${sqlLiteral(d.key)} ` +
            `WHERE id = ${sqlLiteral(d.id)} AND fact_key IS NULL;`,
        );
      }
      console.log('COMMIT;');
    }

    if (APPLY) {
      console.log('\n--- APPLYING ---');
      await client.query('BEGIN');
      let changed = 0;
      for (const d of derivable) {
        const res = await client.query(
          `UPDATE "GeneratedQuestion" SET fact_key = $1 WHERE id = $2 AND fact_key IS NULL`,
          [d.key, d.id],
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
