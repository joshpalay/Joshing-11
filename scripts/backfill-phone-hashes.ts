// One-shot script: populate users.phone_hash for every row with a phone
// number but no hash yet. SHA-256(salt + E.164(phone)) — server side of the
// B-Friends-4 contact-hash matching channel. Skips rows where phone_hash is
// already set (idempotent) and rows whose phoneNumber doesn't normalize to
// a valid US E.164 (logged for manual review).
//
// PHONE_HASH_SALT must be set in the environment — without it the hash
// can't be computed. The salt is the same one served by
// /api/account/phone-hash-salt to clients; rotating it invalidates every
// hashed row.
//
// Usage:
//   PHONE_HASH_SALT=... npx tsx scripts/backfill-phone-hashes.ts            # dry-run
//   PHONE_HASH_SALT=... npx tsx scripts/backfill-phone-hashes.ts --apply    # actually write

import 'dotenv/config';

import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { normalizeToE164 } from '../src/lib/phone-e164';
import { db, pool, users } from '../src/server/db';
import { hashPhoneNumber } from '../src/server/lib/phone-hashing';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

async function main() {
  if (!process.env.PHONE_HASH_SALT) {
    console.error('[backfill-phone-hashes] PHONE_HASH_SALT is not set. Exiting.');
    process.exitCode = 1;
    return;
  }

  console.log(`[backfill-phone-hashes] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const candidates = await db
    .select({ id: users.id, phoneNumber: users.phoneNumber })
    .from(users)
    .where(and(isNotNull(users.phoneNumber), isNull(users.phoneHash)));

  console.log(`[backfill-phone-hashes] ${candidates.length} users without a phone hash.`);

  let hashed = 0;
  let skipped = 0;

  for (const user of candidates) {
    const e164 = normalizeToE164(user.phoneNumber);
    if (!e164) {
      console.warn(
        `[backfill-phone-hashes] skip ${user.id} — phone ${user.phoneNumber} did not normalize to E.164`,
      );
      skipped++;
      continue;
    }
    const phoneHash = hashPhoneNumber(e164);
    console.log(`[backfill-phone-hashes] ${user.id} → ${phoneHash.slice(0, 8)}…`);
    if (APPLY) {
      // Race-safe: only update rows that still have NULL phone_hash. Avoids
      // clobbering a phone_hash written by the signup hook between the
      // SELECT and the UPDATE.
      await db
        .update(users)
        .set({ phoneHash, updatedAt: new Date() })
        .where(and(eq(users.id, user.id), isNull(users.phoneHash)));
      hashed++;
    }
  }

  console.log(`\n[backfill-phone-hashes] done. hashed=${hashed} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error('[backfill-phone-hashes] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
