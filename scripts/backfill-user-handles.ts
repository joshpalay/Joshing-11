// One-shot script: assign a handle to every user that doesn't have one yet.
//
// Strategy:
//   1. Sanitize the user's displayName into the [a-z0-9_]+ allowed set.
//   2. Truncate to 15 chars, append a 4-char random hex suffix (20 char cap).
//   3. If the result collides (rare), retry with a fresh suffix up to 5 times.
//   4. After 5 collisions, fall back to `user_<first 8 of UUID>`.
//
// Idempotent: skips rows where handle is already set. Safe to re-run.
//
// Usage:
//   npx tsx scripts/backfill-user-handles.ts            # dry-run
//   npx tsx scripts/backfill-user-handles.ts --apply    # actually write

import 'dotenv/config';

import { randomBytes } from 'crypto';
import { eq, isNull } from 'drizzle-orm';

import { db, pool, users } from '../src/server/db';
import {
  isReservedHandle,
  isValidHandleFormat,
  sanitizeForHandle,
} from '../src/server/lib/handle-validation';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

function fourCharSuffix(): string {
  return randomBytes(2).toString('hex');
}

function fallbackHandle(userId: string): string {
  const slug = userId.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `user_${slug}`;
}

async function pickHandleForUser(userId: string, displayName: string | null): Promise<string> {
  const base = sanitizeForHandle(displayName ?? '');

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!base) break;
    const suffix = fourCharSuffix();
    const trimmedBase = base.slice(0, 15);
    const candidate = `${trimmedBase}${suffix}`.toLowerCase();
    if (!isValidHandleFormat(candidate)) continue;
    if (isReservedHandle(candidate)) continue;

    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, candidate))
      .limit(1);

    if (taken.length === 0) return candidate;
  }

  return fallbackHandle(userId);
}

async function main() {
  console.log(`[backfill-user-handles] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const candidates = await db
    .select({ id: users.id, displayName: users.displayName, handle: users.handle })
    .from(users)
    .where(isNull(users.handle));

  console.log(`[backfill-user-handles] ${candidates.length} users without a handle.`);

  let assigned = 0;
  let skipped = 0;
  let fallbacks = 0;

  for (const user of candidates) {
    const chosen = await pickHandleForUser(user.id, user.displayName);
    if (chosen.startsWith('user_')) fallbacks++;

    console.log(`[backfill-user-handles] ${user.id} (${user.displayName ?? '—'}) → ${chosen}`);

    if (APPLY) {
      try {
        await db
          .update(users)
          .set({ handle: chosen, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        assigned++;
      } catch (err) {
        console.warn(
          `[backfill-user-handles]   collision on ${chosen}:`,
          err instanceof Error ? err.message : err,
        );
        skipped++;
      }
    }
  }

  console.log(`\n[backfill-user-handles] done. assigned=${assigned}, fallback=${fallbacks}, skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error('[backfill-user-handles] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
