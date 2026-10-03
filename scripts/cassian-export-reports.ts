/** Private, read-only regression material. Never commit the generated JSON. */
import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import pg from 'pg';

config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const privateRoot = resolve('_scratch/Cassian');
  const output = resolve(process.env.CASSIAN_REPORT_EXPORT || '_scratch/Cassian/reported-questions-private.json');
  if (!output.startsWith(privateRoot + sep)) throw new Error('Export must stay under ignored _scratch/Cassian');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  let rows: Record<string, unknown>[];
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      WITH snapshots AS (
        SELECT r.id AS report_id, s.slot ->> 'question_text' AS question_text,
          s.slot ->> 'reveal_canonical_answer' AS revealed_answer,
          d.queue_date,
          row_number() OVER (PARTITION BY r.id ORDER BY d.queue_date DESC) AS rank
        FROM "ContentReport" r
        JOIN "DailyQueue" d ON d.queue_date <= r.created_at::date
        CROSS JOIN LATERAL jsonb_array_elements(d.slots) AS s(slot)
        WHERE (r.question_id IS NOT NULL AND s.slot ->> 'question_id' = r.question_id)
           OR (r.generated_question_id IS NOT NULL
             AND s.slot ->> 'generated_question_id' = r.generated_question_id)
      )
      SELECT r.id AS report_id, r.category, r.incorrect_kind, r.status,
        r.review_decision, r.note, r.suggested_answer, r.review_reason,
        r.created_at, r.reviewed_at,
        CASE WHEN r.question_id IS NULL THEN 'generated' ELSE 'curated' END AS target_kind,
        s.question_text AS prior_queue_text, s.revealed_answer AS prior_queue_answer,
        s.queue_date AS prior_queue_date,
        COALESCE(q.question_text, g.question_text) AS current_text,
        COALESCE(q.answer_text, g.answer) AS current_answer
      FROM "ContentReport" r
      LEFT JOIN snapshots s ON s.report_id = r.id AND s.rank = 1
      LEFT JOIN "Question" q ON q.id = r.question_id
      LEFT JOIN "GeneratedQuestion" g ON g.id = r.generated_question_id
      ORDER BY r.created_at, r.id`);
    rows = result.rows;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }

  const cases = rows.map((row) => ({
    ...row,
    evidenceClass: row.status === 'upheld' ? 'admin_upheld'
      : row.review_decision === 'admin_edited' && row.prior_queue_text
        ? 'edited_with_prior_queue_snapshot'
        : 'reported_unresolved_or_other',
    provenanceCaveat: 'Prior queue text was shown on or before report date; it is not a report-time snapshot.',
  }));
  const serialized = JSON.stringify({ exportedAt: new Date().toISOString(),
    purpose: 'Private development/regression examples, not an unseen eval set or training data', cases }, null, 2) + '\n';
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized, { flag: 'w' });
  const classes = cases.reduce<Record<string, number>>((counts, row) => {
    counts[row.evidenceClass] = (counts[row.evidenceClass] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ output, count: cases.length,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    classes }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
