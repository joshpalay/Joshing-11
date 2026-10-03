/** Read-only, aggregate audit of reported-question examples. Prints no user text. */
import { config } from 'dotenv';
import pg from 'pg';

config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      WITH reports AS (
        SELECT r.id, r.category, r.status, r.review_decision,
          r.created_at, r.question_id, r.generated_question_id,
          COALESCE(q.question_text, g.question_text) AS current_text
        FROM "ContentReport" r
        LEFT JOIN "Question" q ON q.id = r.question_id
        LEFT JOIN "GeneratedQuestion" g ON g.id = r.generated_question_id
      ), snapshots AS (
        SELECT r.id, s.slot ->> 'question_text' AS text
        FROM reports r
        JOIN "DailyQueue" d ON d.queue_date <= r.created_at::date
        CROSS JOIN LATERAL jsonb_array_elements(d.slots) AS s(slot)
        WHERE (r.question_id IS NOT NULL AND s.slot ->> 'question_id' = r.question_id)
           OR (r.generated_question_id IS NOT NULL
             AND s.slot ->> 'generated_question_id' = r.generated_question_id)
      ), grouped AS (
        SELECT id, count(DISTINCT NULLIF(text, ''))::int AS snapshot_versions,
          count(DISTINCT NULLIF(text, '')) FILTER (WHERE text <> r.current_text)::int
            AS differing_versions
        FROM snapshots JOIN reports r USING (id)
        GROUP BY id
      )
      SELECT r.category, r.status, COALESCE(r.review_decision, '(none)') AS review_decision,
        count(*)::int AS reports,
        count(*) FILTER (WHERE r.current_text IS NULL)::int AS missing_current_target,
        count(*) FILTER (WHERE g.snapshot_versions > 0)::int AS with_prior_queue_snapshot,
        count(*) FILTER (WHERE g.differing_versions > 0)::int AS with_text_different_from_current,
        count(*) FILTER (WHERE g.snapshot_versions > 1)::int AS with_multiple_snapshot_versions
      FROM reports r LEFT JOIN grouped g USING (id)
      GROUP BY r.category, r.status, r.review_decision
      ORDER BY r.category, r.status, review_decision`);
    console.log(JSON.stringify({ reportSnapshotAudit: result.rows,
      caveat: 'A queue snapshot is evidence of text shown, not proof that it was the exact reported version. No report-time text/version is stored in ContentReport.' }, null, 2));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
