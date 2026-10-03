/** Convert the private run checkpoint into aggregate, review-safe metrics. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RecordValue = { usd: number; elapsedMs: number };
type CandidateValue = { status: string; checks: { sourceFound?: boolean; parsedCount?: number } };
if (!process.env.CASSIAN_MANIFEST_FILE) throw new Error('CASSIAN_MANIFEST_FILE must point to the private frozen manifest.');
const manifest = JSON.parse(readFileSync(resolve(process.env.CASSIAN_MANIFEST_FILE), 'utf8')) as { id: string };
const privatePath = resolve('_scratch/Cassian', manifest.id, 'checkpoint.json');
const run = JSON.parse(readFileSync(privatePath, 'utf8')) as {
  calls: Record<string, RecordValue>;
  candidates: Record<string, CandidateValue>;
};
const groups = ['source', 'writer', 'quality', 'factual'].map((scope) => {
  const rows = Object.entries(run.calls)
    .filter(([key]) => key.startsWith(`${scope}:`))
    .map(([, value]) => value);
  const sortedMs = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  return {
    scope, calls: rows.length,
    usd: Number(rows.reduce((sum, row) => sum + row.usd, 0).toFixed(6)),
    p50Ms: sortedMs.length ? sortedMs[Math.ceil(sortedMs.length * 0.5) - 1] : null,
    p95Ms: sortedMs.length ? sortedMs[Math.ceil(sortedMs.length * 0.95) - 1] : null,
  };
});
const arms = ['baseline', 'candidate'].map((arm) => {
  const rows = Object.entries(run.candidates)
    .filter(([key]) => key.endsWith(`:${arm}`))
    .map(([, value]) => value);
  return {
    arm, requested: rows.length,
    parsed: rows.filter((row) => (row.checks.parsedCount ?? 0) > 0).length,
    coreGatePassed: rows.filter((row) => row.status === 'passed_core_gates').length,
    held: rows.filter((row) => row.status === 'held').length,
    parseFailed: rows.filter((row) => row.status === 'parse_failed').length,
    withSource: rows.filter((row) => row.checks.sourceFound).length,
    humanReviewed: 0,
  };
});
const output = {
  runId: manifest.id,
  status: 'machine_screened_human_review_pending',
  topics: groups.find((group) => group.scope === 'source')?.calls ?? 0,
  candidateSnapshots: Object.keys(run.candidates).length,
  arms,
  stages: groups,
  totalUsd: Number(groups.reduce((sum, group) => sum + group.usd, 0).toFixed(6)),
  reservedUsd: 0,
  limitation: 'Core gates only; no human quality verdict or live-player topic-to-ready timing.',
};
const outputDir = resolve('Cassian/runs', manifest.id);
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'metrics.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
