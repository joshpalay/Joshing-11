// Read-only production DB queries for confirming a finding's cause. Every
// statement runs inside BEGIN READ ONLY and is rolled back. Run from the repo
// root (reads DATABASE_URL from .env). Separate statements with ";;" on stdin.
//
//   node scripts/qa/ro-query.cjs < queries.sql
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const input = require('fs').readFileSync(0, 'utf8');
  for (const statement of input.split(';;').map((x) => x.trim()).filter(Boolean)) {
    const result = await client.query(statement);
    console.log(JSON.stringify(result.rows, null, 1));
  }
  await client.query('ROLLBACK');
  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
