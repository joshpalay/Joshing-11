// One-shot script: populate users.avatar_color for every row that still has
// NULL. Uses the existing colorForUser() so the persisted value matches what
// the runtime helper has been computing — users won't see their avatar color
// change when downstream callers start reading the column.
//
// Idempotent: skips rows that already have a color.
//
// Usage:
//   npx tsx scripts/backfill-avatar-colors.ts            # dry-run
//   npx tsx scripts/backfill-avatar-colors.ts --apply    # actually write

import 'dotenv/config';

import { eq, isNull } from 'drizzle-orm';

import { colorForUser } from '../src/components/feed/visual';
import { db, pool, users } from '../src/server/db';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

async function main() {
  console.log(`[backfill-avatar-colors] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.avatarColor));

  console.log(`[backfill-avatar-colors] ${candidates.length} users without an avatar color.`);

  let updated = 0;

  for (const user of candidates) {
    const color = colorForUser(user.id);
    console.log(`[backfill-avatar-colors] ${user.id} → ${color}`);
    if (APPLY) {
      await db
        .update(users)
        .set({ avatarColor: color, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      updated++;
    }
  }

  console.log(`\n[backfill-avatar-colors] done. updated=${updated}`);
}

main()
  .catch((err) => {
    console.error('[backfill-avatar-colors] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
