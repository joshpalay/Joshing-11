/**
 * Reconcile drizzle-kit tracking state with reality:
 *  - Hand-written migrations get added to _journal.json so drizzle-kit
 *    knows about them.
 *  - Migrations already applied to the DB (via manual node-script
 *    workarounds) get inserted into __drizzle_migrations so drizzle-kit
 *    doesn't try to re-apply them.
 *  - Diagnostic scripts from this audit session (apply-0032.mjs,
 *    check-ceremony-index.mjs) are deleted.
 *
 * Default mode: REPORT ONLY (read-only). Run with --apply to mutate.
 *
 * Usage:
 *   node scripts/reconcile-drizzle.mjs           # report only
 *   node scripts/reconcile-drizzle.mjs --apply   # actually fix
 */
import { Client } from 'pg'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'

const APPLY = process.argv.includes('--apply')
const DRIZZLE_DIR = 'drizzle'
const JOURNAL_PATH = join(DRIZZLE_DIR, 'meta', '_journal.json')

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function readMigrationFiles() {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((file) => {
      const tag = file.replace(/\.sql$/, '')
      const idx = parseInt(tag.slice(0, 4), 10)
      const content = readFileSync(join(DRIZZLE_DIR, file), 'utf-8')
      return { file, tag, idx, content, hash: sha256(content) }
    })
}

function readJournal() {
  return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'))
}

async function tableExists(c, tableName) {
  const r = await c.query(
    `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
    [tableName],
  )
  return r.rows.length > 0
}

async function readAppliedMigrations(c) {
  // drizzle stores applied migrations in __drizzle_migrations under the
  // 'drizzle' schema. Try both common locations.
  for (const schema of ['drizzle', 'public']) {
    try {
      const r = await c.query(
        `SELECT hash, created_at FROM "${schema}".__drizzle_migrations ORDER BY id`,
      )
      return { schema, rows: r.rows }
    } catch {
      /* try next */
    }
  }
  return { schema: null, rows: [] }
}

async function main() {
  const files = readMigrationFiles()
  const journal = readJournal()
  const journalTags = new Set(journal.entries.map((e) => e.tag))

  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  const applied = await readAppliedMigrations(c)
  const appliedHashes = new Set(applied.rows.map((r) => r.hash))

  console.log(`\nFound ${files.length} migration files in ${DRIZZLE_DIR}/`)
  console.log(`Journal has ${journal.entries.length} entries`)
  console.log(
    applied.schema
      ? `__drizzle_migrations (${applied.schema} schema): ${applied.rows.length} rows`
      : '__drizzle_migrations: TABLE NOT FOUND — first migrate will create it',
  )

  // Confirm hash algorithm using one applied file as a sanity check.
  if (applied.rows.length > 0) {
    const fileHashes = new Set(files.map((f) => f.hash))
    const matchedAny = applied.rows.some((r) => fileHashes.has(r.hash))
    console.log(
      matchedAny
        ? '✓ Hash algorithm verified (sha256 of file content) — found matching entries.'
        : '⚠ No hash matches between DB and files. drizzle may use a different algorithm. Aborting before any --apply.',
    )
    if (!matchedAny && APPLY) {
      console.error('Refusing to apply without a verified hash algorithm.')
      await c.end()
      process.exit(1)
    }
  }

  const missingFromJournal = files.filter((f) => !journalTags.has(f.tag))
  const missingFromDb = files.filter((f) => !appliedHashes.has(f.hash))

  console.log(`\nMissing from _journal.json: ${missingFromJournal.length}`)
  for (const m of missingFromJournal) console.log(`  - ${m.file}`)
  console.log(`Missing from __drizzle_migrations: ${missingFromDb.length}`)
  for (const m of missingFromDb) console.log(`  - ${m.file}`)

  if (!APPLY) {
    console.log('\nDry run — pass --apply to reconcile and clean up helper scripts.')
    await c.end()
    return
  }

  // --- apply: journal
  if (missingFromJournal.length > 0) {
    const maxIdx = Math.max(-1, ...journal.entries.map((e) => e.idx))
    let nextIdx = maxIdx + 1
    for (const m of missingFromJournal) {
      journal.entries.push({
        idx: nextIdx++,
        version: '7',
        when: Date.now(),
        tag: m.tag,
        breakpoints: true,
      })
    }
    writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2) + '\n')
    console.log(`✓ Added ${missingFromJournal.length} entries to ${JOURNAL_PATH}`)
  }

  // --- apply: __drizzle_migrations
  if (missingFromDb.length > 0) {
    const schema = applied.schema ?? 'drizzle'
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await c.query(
      `CREATE TABLE IF NOT EXISTS "${schema}".__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    )
    for (const m of missingFromDb) {
      await c.query(
        `INSERT INTO "${schema}".__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [m.hash, Date.now()],
      )
    }
    console.log(
      `✓ Inserted ${missingFromDb.length} entries into ${schema}.__drizzle_migrations`,
    )
  }

  // --- apply: delete helper scripts
  const helpers = [
    join('scripts', 'check-ceremony-index.mjs'),
    join('scripts', 'apply-0032.mjs'),
  ]
  for (const path of helpers) {
    if (existsSync(path)) {
      rmSync(path)
      console.log(`✓ Deleted ${path}`)
    } else {
      console.log(`  (skipped) ${path} not present`)
    }
  }

  console.log(
    '\nDone. Future migrations: hand-write SQL in drizzle/, then `npm run db:migrate`.',
  )
  await c.end()
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
