// RECOMMENDED RUN SEQUENCE FOR PRODUCTION CLEANUP:
//
// 1. Run dry-run against your own user first:
//    npx tsx scripts/backfill-domains.ts --dry-run --user-id=YOUR_ID
//    Inspect the proposed merges. Confirm they look right.
//
// 2. Apply against your own user:
//    npx tsx scripts/backfill-domains.ts --apply --user-id=YOUR_ID
//    Visit /knowledge in your account. Confirm the result is correct.
//
// 3. Dry-run against all users:
//    npx tsx scripts/backfill-domains.ts --dry-run
//    Inspect the summary. Look for any user with surprising merges.
//
// 4. Apply against all users:
//    npx tsx scripts/backfill-domains.ts --apply
//
// This script is safe to run multiple times — once a user's domains
// are clean, subsequent runs propose zero merges.

import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db, pool, users } from '../src/server/db';
import { runAggressiveDomainBackfillForUser } from '../src/server/mastery/ceremony';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const userIdArg = args.find((a) => a.startsWith('--user-id='))?.replace('--user-id=', '');

if (DRY_RUN) {
  console.log('[backfill-domains] DRY RUN — no data will be modified. Pass --apply to mutate.\n');
} else {
  console.log('[backfill-domains] APPLY mode — data will be modified.\n');
}

async function main() {
  const userIds: string[] = [];

  if (userIdArg) {
    userIds.push(userIdArg);
  } else {
    const onboardedUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.onboardingComplete, true));
    userIds.push(...onboardedUsers.map((u) => u.id));
    console.log(`[backfill-domains] found ${userIds.length} onboarded users\n`);
  }

  let totalProposed = 0;
  let totalApplied = 0;
  let totalErrors = 0;

  for (const userId of userIds) {
    try {
      const result = await runAggressiveDomainBackfillForUser(userId, { dryRun: DRY_RUN });
      totalProposed += result.mergesProposed;
      totalApplied += result.mergesApplied;

      if (!DRY_RUN && result.mergesApplied > 0) {
        console.log(`  domains: ${result.domainsBefore} → ${result.domainsAfter}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-domains] user=${userId} ERROR: ${message}`);
      totalErrors += 1;
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`[backfill-domains] SUMMARY`);
  console.log(`  users processed : ${userIds.length}`);
  console.log(`  merges proposed : ${totalProposed}`);
  console.log(`  merges applied  : ${totalApplied}${DRY_RUN ? ' (dry run — none applied)' : ''}`);
  if (totalErrors > 0) {
    console.log(`  errors          : ${totalErrors}`);
  }
  console.log('─────────────────────────────────────────');

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill-domains] fatal:', err);
  process.exit(1);
});
