// Supply backfill CLI — thin wrapper over runSupplyBackfill (src/server/daily/
// supply-backfill.ts), shared with the nightly cron. Dry-run by default: prints
// the per-domain plan + rough cost and makes ZERO generation calls. Add --run to
// generate → gate → persist. --run persists only when RETRIEVAL_SYSTEM_USER_ID
// is set (the owning user for pool rows).
//
// Usage (prod DB + secrets both live in .env.local):
//   npx tsx -r dotenv/config scripts/backfill-supply.ts dotenv_config_path=.env.local
//   npx tsx -r dotenv/config scripts/backfill-supply.ts --run --limit 5 dotenv_config_path=.env.local
//   ...add --domain "Hamlet" to target one domain.
import 'dotenv/config';

import { pool } from '../src/server/db';
import { runSupplyBackfill } from '../src/server/daily/supply-backfill';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const num = (f: string, d: number) => {
  const i = argv.indexOf(f);
  if (i === -1 || i + 1 >= argv.length) return d;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : d;
};
const str = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
};

const usd = (x: number) => `$${x.toFixed(4)}`;

async function main() {
  const dryRun = !has('--run');
  const report = await runSupplyBackfill({
    dryRun,
    limit: num('--limit', 12),
    onlyDomain: str('--domain'),
    systemUserId: process.env.RETRIEVAL_SYSTEM_USER_ID?.trim() || null,
    daysRunway: num('--days-runway', Number(process.env.SUPPLY_BACKFILL_DAYS_RUNWAY ?? 14)),
    bufferFloor: num('--buffer-floor', Number(process.env.SUPPLY_BACKFILL_BUFFER_FLOOR ?? 10)),
    batchCap: num('--batch-cap', Number(process.env.SUPPLY_BACKFILL_BATCH_CAP ?? 20)),
  });

  console.info('=== Supply backfill plan ===');
  console.info({
    mode: dryRun ? 'DRY-RUN (no LLM calls; pass --run to execute)' : 'RUN (generate + gate + persist)',
    domainsWithEstimate: report.domainsWithEstimate,
    actionableDomains: report.actionableDomains,
    systemUser: report.systemUser ? 'set' : 'UNSET (persist disabled)',
  });

  const actionable = report.plans.filter((p) => p.batch > 0);
  console.info('\n%s', ['DOMAIN'.padEnd(38), 'int', 'have', 'cap', 'targ', 'batch', 'grnd', 'est$'].join('  '));
  for (const p of actionable) {
    console.info(
      [
        p.label.slice(0, 38).padEnd(38),
        String(p.interested).padStart(3),
        String(p.have).padStart(4),
        String(p.cap).padStart(4),
        String(p.bufferTarget).padStart(4),
        String(p.batch).padStart(5),
        (p.ground ? 'yes' : 'no').padStart(4),
        usd(p.estCostUsd).padStart(8),
      ].join('  '),
    );
  }
  console.info(
    `\nTOTAL: ${actionable.length} domains, ${report.totalQuestionsPlanned} questions, rough cost ${usd(report.estCostUsd)} ` +
      `(~${usd(report.totalQuestionsPlanned > 0 ? report.estCostUsd / report.totalQuestionsPlanned : 0)}/question).`,
  );

  if (report.dryRun) {
    console.info('\nDRY-RUN complete. No questions generated. Re-run with --run to build.');
  } else {
    let g = 0, pz = 0;
    console.info('\n=== Built ===');
    for (const b of report.built) {
      console.info(`  ${b.label}: generated ${b.generated} → persisted ${b.persisted}`);
      g += b.generated; pz += b.persisted;
    }
    console.info(`\n=== Done: generated ${g}, persisted ${pz} across ${report.built.length} domains ===`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[backfill-supply] failed:', err);
  process.exitCode = 1;
});
