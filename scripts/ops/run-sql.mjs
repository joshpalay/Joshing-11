// One-off SQL runner for ops fixes against the writable DIRECT_URL.
// Usage: node scripts/ops/run-sql.mjs scripts/ops/<file>.sql
import { readFileSync } from 'node:fs';
import pg from 'pg';

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(file, 'utf8');
      const m = txt.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return undefined;
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('usage: node scripts/ops/run-sql.mjs <file.sql>');
  process.exit(1);
}
const connectionString = readEnv('DIRECT_URL') ?? readEnv('DATABASE_URL');
if (!connectionString) {
  console.error('No DIRECT_URL/DATABASE_URL found');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

const out = await (async () => {
  await client.connect();
  try {
    const results = await client.query(sql); // file carries its own begin/commit
    const arr = Array.isArray(results) ? results : [results];
    for (const r of arr) {
      if (r.command) console.log(`${r.command} ${r.rowCount ?? ''}`.trim());
      if (r.rows && r.rows.length) console.table(r.rows);
    }
    return 'ok';
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error('SQL FAILED (transaction rolled back):', e.message);
  process.exit(1);
});

console.log('done:', out);
