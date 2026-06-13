// One-time backfill: rewrite existing knowledge labels to the standardized
// capitalization produced by titleCaseDomain — the same normalization now applied
// at write time (normalizeDeclaredInterest) and display time (displayNameForDomain).
// Targets DeclaredInterest.domain and PLAYER_MASTERY.canonical_subcategory.
//
// SAFE BY DESIGN:
//   - Casing never affects territory matching (domainKey() lowercases before
//     comparison), so restyling a label cannot fragment or merge mastery points.
//   - Both tables have a UNIQUE(user, label) constraint. If re-casing a row would
//     collide with another label the same user already has (e.g. they have both
//     "Hip Hop" and "hip hop"), the row is SKIPPED and reported rather than
//     merged — merging mastery rows is out of scope for a cosmetic backfill.
//   - Idempotent: rows already in canonical casing are left untouched, so the
//     script can be re-run safely.
//
// Usage:
//   npx tsx scripts/backfill-domain-casing.ts            # dry run (counts + sample)
//   npx tsx scripts/backfill-domain-casing.ts --apply    # write the changes
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db, pool, declaredInterests, playerMastery } from '../src/server/db';
import { titleCaseDomain } from '../src/lib/knowledge/domain-casing';

const APPLY = process.argv.slice(2).includes('--apply');

type Row = { id: string; userId: string; name: string };
type Update = { id: string; from: string; to: string };
type Collision = { id: string; userId: string; from: string; wanted: string };

type Plan = { updates: Update[]; collisions: Collision[] };

// Build a safe rename plan for one table's rows. Rows are grouped per user so the
// UNIQUE(user, label) constraint can be respected: a rename that would collide
// with a label the user already holds is recorded as a collision, not an update.
function planRenames(rows: Row[]): Plan {
  const byUser = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  const updates: Update[] = [];
  const collisions: Collision[] = [];

  for (const userRows of byUser.values()) {
    // Names currently claimed by this user (used to detect collisions).
    const claimed = new Set(userRows.map((r) => r.name));
    for (const row of userRows) {
      const target = titleCaseDomain(row.name);
      if (!target || target === row.name) continue; // already canonical / empty
      if (claimed.has(target)) {
        collisions.push({ id: row.id, userId: row.userId, from: row.name, wanted: target });
        continue;
      }
      claimed.delete(row.name);
      claimed.add(target);
      updates.push({ id: row.id, from: row.name, to: target });
    }
  }

  return { updates, collisions };
}

function report(label: string, rows: Row[], plan: Plan): void {
  console.log(`\n[backfill-domain-casing] ${label}: ${rows.length} rows`);
  console.log(
    `[backfill-domain-casing] ${label}: ${plan.updates.length} to re-case, ${plan.collisions.length} skipped (would collide)`,
  );
  for (const u of plan.updates.slice(0, 20)) {
    console.log(`    "${u.from}"  ->  "${u.to}"`);
  }
  if (plan.updates.length > 20) {
    console.log(`    … and ${plan.updates.length - 20} more`);
  }
  for (const c of plan.collisions) {
    console.log(
      `    SKIP (collision) "${c.from}" -> "${c.wanted}" already held by user ${c.userId}`,
    );
  }
}

// Each table needs its own typed UPDATE (different column key), so the caller
// passes a concrete writer. This keeps Drizzle's column types intact rather than
// indexing a union table dynamically.
async function applyUpdates(
  updates: Update[],
  write: (id: string, value: string) => Promise<unknown>,
): Promise<number> {
  let applied = 0;
  for (const u of updates) {
    try {
      await write(u.id, u.to);
      applied += 1;
    } catch (err) {
      // A residual UNIQUE violation (e.g. concurrent writes) — leave the row as-is.
      console.warn(
        `[backfill-domain-casing] skipped ${u.id} ("${u.from}" -> "${u.to}"):`,
        String(err),
      );
    }
  }
  return applied;
}

async function main() {
  console.log(`[backfill-domain-casing] ${APPLY ? 'APPLY' : 'DRY RUN'} mode`);

  const interestRows: Row[] = (
    await db
      .select({
        id: declaredInterests.id,
        userId: declaredInterests.userId,
        name: declaredInterests.domain,
      })
      .from(declaredInterests)
  ).map((r) => ({ id: r.id, userId: r.userId, name: r.name }));

  const masteryRows: Row[] = (
    await db
      .select({
        id: playerMastery.id,
        userId: playerMastery.userId,
        name: playerMastery.canonicalSubcategory,
      })
      .from(playerMastery)
  ).map((r) => ({ id: r.id, userId: r.userId, name: r.name }));

  const interestPlan = planRenames(interestRows);
  const masteryPlan = planRenames(masteryRows);

  report('DeclaredInterest', interestRows, interestPlan);
  report('PLAYER_MASTERY', masteryRows, masteryPlan);

  if (!APPLY) {
    console.log(
      '\n[backfill-domain-casing] dry run only — re-run with --apply to write the changes.',
    );
    return;
  }

  const interestsApplied = await applyUpdates(interestPlan.updates, (id, value) =>
    db.update(declaredInterests).set({ domain: value }).where(eq(declaredInterests.id, id)),
  );
  const masteryApplied = await applyUpdates(masteryPlan.updates, (id, value) =>
    db.update(playerMastery).set({ canonicalSubcategory: value }).where(eq(playerMastery.id, id)),
  );

  console.log(
    `\n[backfill-domain-casing] done. DeclaredInterest updated=${interestsApplied}, PLAYER_MASTERY updated=${masteryApplied}`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill-domain-casing] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
