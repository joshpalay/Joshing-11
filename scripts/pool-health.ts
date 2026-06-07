/**
 * Pre-flip pool-health check for verification tier gating (DEV-7a / PRD-D-5 §6).
 *
 * Read-only. Prints the eligible pool per serving surface under the §6 tier rules
 * and a per-domain self-practice breakdown, then a readiness verdict — so you can
 * confirm pools are healthy BEFORE setting VERIFICATION_TIER_GATING_ENABLED=true.
 * Enabling the flag while pools are thin starves daily play (the audit's hazard);
 * this is the gate that prevents that.
 *
 *   npm run pool:health            # default thin threshold = 5 eligible rows/domain
 *   npm run pool:health -- 10      # custom threshold
 *
 * Nothing is written and no flag is changed. Exit code is 1 only when a surface
 * has zero eligible rows or any domain is below the thin threshold, so CI/ops can
 * treat a non-zero exit as "not ready yet".
 */
import 'dotenv/config';

import { pool } from '../src/server/db';
import {
  getPoolReport,
  getSelfPracticeEligibilityByDomain,
} from '../src/server/db/queries/pool-report';
import { isTierGatingEnabled } from '../src/server/daily/verification-gating';

function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const thinThreshold = Number(process.argv[2] ?? 5);

  const [report, byDomain] = await Promise.all([
    getPoolReport(),
    getSelfPracticeEligibilityByDomain(),
  ]);

  const machineTotal =
    report.machineBank.unverified +
    report.machineBank.machine_verified +
    report.machineBank.human_validated +
    report.machineBank.author_confirmed;
  const humanTotal =
    report.humanAuthored.unverified +
    report.humanAuthored.machine_verified +
    report.humanAuthored.human_validated +
    report.humanAuthored.author_confirmed;

  console.log('\n=== Verification tier-gating pool health ===');
  console.log(`tier gating currently enforced: ${isTierGatingEnabled() ? 'YES' : 'no (shadow-log)'}`);
  console.log(`thin-domain threshold: < ${thinThreshold} eligible rows\n`);

  console.log('Machine bank (Daily Five source) by tier:', report.machineBank);
  console.log('Human-authored by tier:', report.humanAuthored);
  console.log('');
  console.log(
    `self-practice eligible (tier ≥ machine_verified): ${report.eligible.selfPractice} / ${machineTotal} (${pct(report.eligible.selfPractice, machineTotal)}); would-filter ${machineTotal - report.eligible.selfPractice}`,
  );
  console.log(
    `friend-facing eligible (human_validated|author_confirmed): ${report.eligible.friendFacing} / ${humanTotal} (${pct(report.eligible.friendFacing, humanTotal)}); would-filter ${humanTotal - report.eligible.friendFacing}`,
  );
  console.log(`"nobody got it" flagged for review: ${report.nobodyCorrectFlagged}`);

  const thin = byDomain.filter((d) => d.eligible < thinThreshold);
  console.log(`\nThinnest self-practice domains (eligible asc), first 15 of ${byDomain.length}:`);
  for (const d of byDomain.slice(0, 15)) {
    const flag = d.eligible < thinThreshold ? '  ⚠ THIN' : '';
    console.log(`  ${d.eligible}/${d.total}\t${d.broadCategory} › ${d.domain}${flag}`);
  }

  const zeroSurface = report.eligible.selfPractice === 0 || report.eligible.friendFacing === 0;
  const notReady = zeroSurface || thin.length > 0;

  console.log('\n--- verdict ---');
  if (zeroSurface) {
    console.log('NOT READY: a serving surface has zero eligible rows — enabling the flag would empty it.');
  }
  if (thin.length > 0) {
    console.log(
      `NOT READY: ${thin.length} domain(s) below the thin threshold; enabling the flag risks starving those domains.`,
    );
  }
  if (!notReady) {
    console.log('LOOKS READY: every surface has eligible rows and no domain is below the threshold.');
    console.log('(Aggregate signal — individual users may still differ. Spot-check before flipping.)');
  }

  await pool.end();
  process.exitCode = notReady ? 1 : 0;
}

main().catch((err) => {
  console.error('[pool-health] failed', err);
  process.exitCode = 1;
});
