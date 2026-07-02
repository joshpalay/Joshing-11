/**
 * Schema-drift audit — find tables/columns the code's Drizzle models expect that
 * the live database is missing (and columns the DB has that no model declares).
 *
 * Motivation: this database has repeatedly recorded migrations in
 * __drizzle_migrations without their DDL taking effect (reaction table stuck
 * pre-0006; ~49% of GeneratedQuestion.domain_key never backfilled by 0074). The
 * migrator then SKIPS the recorded-but-unapplied migration forever, so the drift
 * is silent until a query hits the missing column at runtime. This diffs the
 * intended shape (Drizzle schema, via introspection — not regex) against the live
 * DB so every such drift is visible at once.
 *
 * Read-only. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/schema-drift-audit.ts
 *   node --import tsx scripts/schema-drift-audit.ts --dump-expected   # print expected shape as JSON, no DB
 */
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { isPgEnum, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';

import * as schema from '../src/server/db/schema';

const DUMP_EXPECTED = process.argv.includes('--dump-expected');
const ACTUAL_IDX = process.argv.indexOf('--actual');
const ACTUAL_FILE = ACTUAL_IDX >= 0 ? process.argv[ACTUAL_IDX + 1] : null;
const ACTUAL_ENUMS_IDX = process.argv.indexOf('--actual-enums');
const ACTUAL_ENUMS_FILE = ACTUAL_ENUMS_IDX >= 0 ? process.argv[ACTUAL_ENUMS_IDX + 1] : null;

// Expected shape: table name -> set of DB column names, straight from Drizzle.
function expectedShape(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableName(value);
    const cols = new Set(Object.values(getTableColumns(value)).map((c) => c.name));
    out.set(name, cols);
  }
  return out;
}

async function main() {
  const expected = expectedShape();

  // Expected enum values, straight from Drizzle pgEnum() introspection.
  const expectedEnums = new Map<string, string[]>();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) expectedEnums.set(value.enumName, [...value.enumValues]);
  }

  if (DUMP_EXPECTED) {
    const obj: Record<string, string[]> = {};
    for (const [t, cols] of expected) obj[t] = [...cols].sort();
    const enums: Record<string, string[]> = {};
    for (const [n, vals] of expectedEnums) enums[n] = vals;
    console.log(JSON.stringify({ tables: obj, enums }, null, 2));
    return;
  }

  // Build the live shape either from a captured snapshot (offline) or the DB.
  const actual = new Map<string, Set<string>>();
  let client: pg.Client | null = null;

  if (ACTUAL_FILE) {
    const fs = await import('node:fs');
    // Accept either {table:[cols]} or MCP's [{table_name, cols:"a,b,c"}] shape.
    const raw = JSON.parse(fs.readFileSync(ACTUAL_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      for (const r of raw) actual.set(r.table_name, new Set(String(r.cols).split(',')));
    } else {
      for (const [t, cols] of Object.entries(raw)) actual.set(t, new Set(cols as string[]));
    }
  } else {
    const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!DB_URL) {
      console.error('No DIRECT_URL/DATABASE_URL in env (or pass --dump-expected / --actual <file>)');
      process.exit(1);
    }
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    const { rows } = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    for (const r of rows) {
      const s = actual.get(r.table_name) ?? new Set<string>();
      s.add(r.column_name);
      actual.set(r.table_name, s);
    }
  }

  try {
    let drifts = 0;
    console.log('\n=== schema-drift audit (code expects → DB missing) ===\n');
    for (const [table, cols] of [...expected].sort()) {
      const live = actual.get(table);
      if (!live) {
        console.log(`✗ TABLE MISSING: ${table} (model declares ${cols.size} columns)`);
        drifts++;
        continue;
      }
      const missing = [...cols].filter((c) => !live.has(c));
      if (missing.length) {
        console.log(`✗ ${table}: missing columns → ${missing.join(', ')}`);
        drifts++;
      }
    }
    if (!drifts) console.log('✓ no missing tables/columns — code and DB agree.');

    // Enum drift: an enum value the code uses but the DB type lacks fails every
    // insert of that value — the same silent break class as a missing column.
    let enumActual: Map<string, Set<string>> | null = null;
    if (ACTUAL_ENUMS_FILE) {
      const fs = await import('node:fs');
      const raw = JSON.parse(fs.readFileSync(ACTUAL_ENUMS_FILE, 'utf8'));
      enumActual = new Map();
      const arr = Array.isArray(raw) ? raw : Object.entries(raw).map(([enum_name, values]) => ({ enum_name, values }));
      for (const r of arr) {
        const vals = Array.isArray(r.values) ? r.values : String(r.values).split(',');
        enumActual.set(r.enum_name, new Set(vals));
      }
    } else if (client) {
      const { rows } = await client.query<{ enum_name: string; value: string }>(`
        SELECT t.typname AS enum_name, e.enumlabel AS value
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      `);
      enumActual = new Map();
      for (const r of rows) {
        const s = enumActual.get(r.enum_name) ?? new Set<string>();
        s.add(r.value);
        enumActual.set(r.enum_name, s);
      }
    }

    if (enumActual) {
      console.log('\n=== enum-drift audit (code uses → DB enum missing value) ===\n');
      let enumDrifts = 0;
      for (const [name, vals] of [...expectedEnums].sort()) {
        const live = enumActual.get(name);
        if (!live) {
          console.log(`✗ ENUM TYPE MISSING: ${name} (code declares ${vals.length} values)`);
          enumDrifts++;
          continue;
        }
        const missing = vals.filter((v) => !live.has(v));
        if (missing.length) {
          console.log(`✗ ${name}: DB missing value(s) → ${missing.join(', ')}`);
          enumDrifts++;
        }
      }
      if (!enumDrifts) console.log('✓ no missing enum values — code and DB agree.');
    }

    // Informational: columns the DB carries that no model declares (often a
    // pre-rename leftover, e.g. the reaction table's old creator_id/answer_id).
    console.log('\n--- DB columns not declared by any model (informational) ---');
    for (const [table, cols] of expected) {
      const live = actual.get(table);
      if (!live) continue;
      const extra = [...live].filter((c) => !cols.has(c));
      if (extra.length) console.log(`  ${table}: ${extra.join(', ')}`);
    }
  } finally {
    if (client) await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
