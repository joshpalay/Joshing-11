/** Aggregate, read-only evidence for a future reference-cache experiment. */
import { config } from 'dotenv';
import pg from 'pg';

config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const cache = await client.query(`
      WITH active AS (SELECT DISTINCT lower(domain) AS domain
        FROM "DeclaredInterest" WHERE "isActive" = true),
      matched AS (SELECT a.domain, p.source, p.fetched_at,
        extract(epoch FROM (now() - p.fetched_at)) / 86400.0 AS age_days
        FROM active a LEFT JOIN "DomainReferencePassage" p
          ON lower(p.canonical_subcategory) = a.domain)
      SELECT count(*)::int AS active_domains,
        count(*) FILTER (WHERE fetched_at IS NULL)::int AS never_cached,
        count(*) FILTER (WHERE age_days < 1)::int AS fresh_24h,
        count(*) FILTER (WHERE age_days >= 1 AND age_days < 7)::int AS age_1_to_7d,
        count(*) FILTER (WHERE age_days >= 7 AND age_days < 14)::int AS age_7_to_14d,
        count(*) FILTER (WHERE age_days >= 14)::int AS older_14d,
        count(*) FILTER (WHERE source = 'none')::int AS negative_cache
      FROM matched`);
    const calls = await client.query(`
      SELECT count(*)::int AS calls_30d,
        COALESCE(sum(web_search_requests),0)::int AS web_searches_30d,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
      FROM "LlmUsageEvent" WHERE scope = 'domain-reference'
        AND created_at >= now() - interval '30 days'`);
    console.log(JSON.stringify({
      cacheSnapshot: cache.rows[0], retrievalCalls: calls.rows[0],
      limitation: 'The cache table keeps only the latest fetch per topic and usage events have no topic field; actual per-topic re-fetch frequency and variety impact cannot be reconstructed from these aggregates.',
    }, null, 2));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(); await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
