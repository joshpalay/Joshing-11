/** Read-only live-schema smoke check. Never allocates a Cassian exposure. */
import { config } from 'dotenv';
import pg from 'pg';

config({ path: process.env.CASSIAN_ENV_FILE || '.env.local' });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const { alreadySeen } = await import('../src/server/cassian/review');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const candidates = await client.query('SELECT * FROM "CassianCandidate" ORDER BY id LIMIT 1');
    if (!candidates.rows[0]) throw new Error('Cassian candidate import missing');
    const seen = await alreadySeen(client, '__cassian_readonly_probe__', candidates.rows[0]);
    const totals = await client.query<{ candidates: number; reviews: number }>(
      'SELECT (SELECT count(*)::int FROM "CassianCandidate") AS candidates, (SELECT count(*)::int FROM "CassianReview") AS reviews',
    );
    if (seen || totals.rows[0].candidates !== 24) throw new Error('Unexpected Cassian smoke result');
    console.log(JSON.stringify({ schema: 'ok', candidates: totals.rows[0].candidates, reviews: totals.rows[0].reviews }));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
