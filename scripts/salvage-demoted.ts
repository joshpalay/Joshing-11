/**
 * Salvage pass over the demoted-question review queue (D-QUALITY-SALVAGE-01).
 *
 * A sample of the queue showed ~80% of demotions are not wrong answers — they
 * are one removable/wrong fact (usually a decorative aside in the explainer)
 * while the ask + headline answer are correct. For each demoted Question this
 * proposes the MINIMAL fix, re-verifies the PROPOSED version, and stores a
 * proposal. Nothing is applied: a human approves each ready diff in the review
 * queue (conservative). Broken cores → 'unsalvageable'.
 *
 * The pipeline itself lives in src/server/quality/salvage-sweep.ts and ALSO runs
 * automatically from the batch-verify cron after each demotion batch (default
 * ON; SALVAGE_ON_DEMOTE_ENABLED=false reverts). This script remains the manual
 * entry point for bulk backfills and dry-run auditing.
 *
 * Read-only by default (proposes + prints a triage census). Run from repo root:
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/salvage-demoted.ts          # dry-run: propose + census, persist nothing
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/salvage-demoted.ts --write   # persist proposals to QuestionSalvageProposal
 *
 * --write only ever touches the QuestionSalvageProposal table; Question/
 * GeneratedQuestion rows are never modified by this script.
 */
import 'dotenv/config';

import { pool } from '../src/server/db';
import { runSalvageSweep } from '../src/server/quality/salvage-sweep';

const WRITE = process.argv.includes('--write');
const CONCURRENCY = 5;
// --limit N: process only the first N un-proposed items (validation runs).
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG.split('=')[1]) || 0) : undefined;

async function main() {
  const summary = await runSalvageSweep({
    persist: WRITE,
    limit: LIMIT,
    concurrency: CONCURRENCY,
    onItem: (item, result) => {
      const stem = item.questionText.slice(0, 60).replace(/\s+/g, ' ');
      console.log(`  [${result.outcome}] ${stem}… — ${result.note}`);
    },
  });

  console.log(
    `\n[salvage] queue=${summary.queued} already_proposed=${summary.alreadyProposed} processed=${summary.processed} mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`,
  );
  console.log('[salvage] census:', JSON.stringify(summary));
  const pct = summary.processed ? Math.round((summary.ready / summary.processed) * 100) : 0;
  console.log(
    `[salvage] ${summary.ready}/${summary.processed} processed became one-click-ready (${pct}%). ${WRITE ? 'Persisted.' : 'Dry-run — re-run with --write to persist.'}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
