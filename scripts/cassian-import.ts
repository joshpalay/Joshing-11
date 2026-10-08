/** Import immutable local pilot snapshots into CassianCandidate only. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

if (!process.env.CASSIAN_MANIFEST_FILE) throw new Error('CASSIAN_MANIFEST_FILE must point to the private frozen manifest.');
const bytes = readFileSync(resolve(process.env.CASSIAN_MANIFEST_FILE));
const manifest = JSON.parse(bytes.toString('utf8')) as {
  id: string; topics: { domain: string; breadth: string }[];
};
const manifestSha = createHash('sha256').update(bytes).digest('hex');
const topicArg = process.argv.indexOf('--topics');
const expectedTopics = topicArg < 0 ? manifest.topics.length : Number(process.argv[topicArg + 1]);
if (![3, 6, 9, 12].includes(expectedTopics)) {
  throw new Error('--topics must be a balanced block of 3, 6, 9, or 12.');
}
const checkpoint = JSON.parse(readFileSync(
  resolve('_scratch/Cassian', manifest.id, 'checkpoint.json'), 'utf8',
)) as {
  manifestSha: string;
  calls: Record<string, { model: string }>;
  candidates: Record<string, {
    question: null | {
      canonical_subcategory: string; question_text: string; answer: string;
      acceptable_variants: string[]; explainer: string; fact_key: string | null;
      difficulty_estimate: string;
    };
    status: string;
    checks: Record<string, unknown>;
  }>;
};
if (checkpoint.manifestSha !== manifestSha) throw new Error('Manifest and checkpoint differ.');

const rows = Object.entries(checkpoint.candidates).map(([key, snapshot]) => {
  const arm = key.endsWith(':baseline') ? 'baseline' : key.endsWith(':candidate') ? 'candidate' : null;
  const domain = arm ? key.slice(0, -(arm.length + 1)) : '';
  const topic = manifest.topics.find((item) => item.domain === domain);
  const question = snapshot.question;
  const writer = checkpoint.calls[`writer:${key}`];
  if (!arm || !topic || !question || !question.fact_key || !writer ||
    !['held', 'passed_core_gates'].includes(snapshot.status)) {
    throw new Error(`Cannot import incomplete candidate ${key}.`);
  }
  const immutable = {
    runId: manifest.id, domain, breadth: topic.breadth, arm, model: writer.model,
    questionText: question.question_text, answer: question.answer,
    acceptableVariants: question.acceptable_variants,
    explainer: question.explainer, factKey: question.fact_key,
    difficulty: question.difficulty_estimate, machineStatus: snapshot.status,
    checks: snapshot.checks,
    sourceUrl: typeof snapshot.checks.sourceUrl === 'string' ? snapshot.checks.sourceUrl : null,
  };
  const id = createHash('sha256').update(`${manifest.id}\0${key}`).digest('hex').slice(0, 32);
  const snapshotSha = createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
  return { id, snapshotSha, ...immutable };
});

const breadthCounts = new Map<string, number>();
for (const domain of new Set(rows.map((row) => row.domain))) {
  const breadth = manifest.topics.find((topic) => topic.domain === domain)?.breadth;
  if (!breadth) throw new Error(`Unknown topic ${domain}.`);
  breadthCounts.set(breadth, (breadthCounts.get(breadth) ?? 0) + 1);
}
if (rows.length !== expectedTopics * 2 || new Set(rows.map((row) => row.id)).size !== rows.length ||
  ['broad', 'niche', 'very narrow'].some((breadth) => breadthCounts.get(breadth) !== expectedTopics / 3) ||
  new Set(rows.map((row) => row.domain)).size !== expectedTopics ||
  [...new Set(rows.map((row) => row.domain))].some((domain) =>
    rows.filter((row) => row.domain === domain).map((row) => row.arm).sort().join(',') !== 'baseline,candidate')) {
  throw new Error('Import requires one unique parsed candidate per topic and arm.');
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'dry-run', runId: manifest.id, candidates: rows.length,
    held: rows.filter((row) => row.machineStatus === 'held').length,
    pass: rows.filter((row) => row.machineStatus === 'passed_core_gates').length,
    writes: 0 }, null, 2));
  process.exit(0);
}

async function applyImport(): Promise<void> {
dotenv.config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  const run = await client.query<{ manifest_sha: string }>(
    'SELECT manifest_sha FROM "CassianRun" WHERE id = $1 FOR UPDATE', [manifest.id],
  );
  if (run.rows[0]?.manifest_sha !== manifestSha) throw new Error('Durable run manifest mismatch.');
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO "CassianCandidate" (
        id, run_id, domain, breadth, arm, model, question_text, answer,
        acceptable_variants, explainer, fact_key, difficulty, machine_status,
        checks, source_url, snapshot_sha
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16)
      ON CONFLICT (id) DO NOTHING`,
      [row.id, row.runId, row.domain, row.breadth, row.arm, row.model,
        row.questionText, row.answer, JSON.stringify(row.acceptableVariants),
        row.explainer, row.factKey, row.difficulty, row.machineStatus,
        JSON.stringify(row.checks), row.sourceUrl, row.snapshotSha],
    );
    inserted += result.rowCount ?? 0;
    if (!result.rowCount) {
      const existing = await client.query<{ snapshot_sha: string }>(
        'SELECT snapshot_sha FROM "CassianCandidate" WHERE id = $1', [row.id],
      );
      if (existing.rows[0]?.snapshot_sha !== row.snapshotSha) {
        throw new Error(`Immutable candidate ${row.id} differs from checkpoint.`);
      }
    }
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ runId: manifest.id, candidates: rows.length, inserted }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
}

applyImport().catch((error) => {
  console.error('[cassian/import]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
