/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) — Phase 3: VALIDATE the recompute
 * engine against the live aggregate.
 *
 * The spec makes PLAYER_MASTERY a rebuildable cache of a projection over
 * (MASTERY_EVENTS × current taxonomy). Before anything trusts that projection, this
 * script proves it reproduces today's stored PLAYER_MASTERY: it reads every event,
 * re-buckets each by its question's CURRENT domain (falling back to the event's
 * stored snapshot), runs the PURE recomputeMastery, and diffs the result against
 * the stored rows — by folded domain_key + user.
 *
 * READ-ONLY — never writes. A clean (or explainable) diff is the green light for
 * the persist step and for reclassification-driven recompute (later phases).
 *
 * Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/validate-mastery-recompute.ts
 */
import pg from 'pg';

import {
  masteryBucketKey,
  recomputeMastery,
  type MasteryEventInput,
} from '../src/server/mastery/recompute';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

type EventRow = {
  user_id: string;
  canonical_subcategory: string;
  question_id: string | null;
  source_type: string;
  awarded_points: string | number;
};
type StoredRow = { user_id: string; canonical_subcategory: string; total_points: string | number; tier: string };

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const [events, genQ, authQ, stored] = await Promise.all([
      client.query<EventRow>(
        `SELECT user_id, canonical_subcategory, question_id, source_type, awarded_points FROM "MASTERY_EVENTS"`,
      ),
      client.query<{ id: string; canonical_subcategory: string }>(
        `SELECT id, canonical_subcategory FROM "GeneratedQuestion"`,
      ),
      client.query<{ id: string; canonical_subcategory: string | null }>(
        `SELECT id, canonical_subcategory FROM "Question" WHERE canonical_subcategory IS NOT NULL`,
      ),
      client.query<StoredRow>(
        `SELECT user_id, canonical_subcategory, total_points, tier FROM "PLAYER_MASTERY"`,
      ),
    ]);

    // Resolver: question id → current domain, from either store (ids are distinct).
    // --stored-only forces the fallback (bucket by the event's stored snapshot),
    // which isolates ENGINE correctness (should reproduce PLAYER_MASTERY exactly)
    // from the v2 POLICY of re-bucketing by the question's current domain.
    const STORED_ONLY = process.argv.includes('--stored-only');
    const domainById = new Map<string, string>();
    for (const r of genQ.rows) domainById.set(r.id, r.canonical_subcategory);
    for (const r of authQ.rows) if (r.canonical_subcategory) domainById.set(r.id, r.canonical_subcategory);
    const resolveDomain = (qid: string): string | null =>
      STORED_ONLY ? null : domainById.get(qid) ?? null;

    const eventInputs: MasteryEventInput[] = events.rows.map((e) => ({
      userId: e.user_id,
      canonicalSubcategory: e.canonical_subcategory,
      questionId: e.question_id,
      sourceType: e.source_type,
      awardedPoints: Number(e.awarded_points),
    }));

    const recomputed = recomputeMastery(eventInputs, resolveDomain);

    // Fold the stored rows to the same (user, domainKey) space.
    const storedByBucket = new Map<string, { points: number; tier: string; label: string }>();
    for (const r of stored.rows) {
      const bucket = masteryBucketKey(r.user_id, r.canonical_subcategory);
      const prev = storedByBucket.get(bucket);
      const points = Number(r.total_points);
      // If two display spellings folded to one key, sum (matches recompute grouping).
      storedByBucket.set(bucket, {
        points: (prev?.points ?? 0) + points,
        tier: r.tier,
        label: r.canonical_subcategory,
      });
    }

    let matched = 0;
    const pointDiffs: string[] = [];
    const tierDiffs: string[] = [];
    const onlyRecomputed: string[] = [];
    const onlyStored: string[] = [];

    for (const [bucket, entry] of recomputed) {
      const s = storedByBucket.get(bucket);
      if (!s) {
        // A recomputed bucket with 0 net points is not expected to have a stored row.
        if (Math.round(entry.totalPoints) !== 0) onlyRecomputed.push(`${bucket} (+${Math.round(entry.totalPoints)})`);
        continue;
      }
      const pointsMatch = Math.round(entry.totalPoints) === Math.round(s.points);
      const tierMatch = entry.tier === s.tier;
      if (pointsMatch && tierMatch) matched += 1;
      if (!pointsMatch) pointDiffs.push(`${bucket}: recompute ${Math.round(entry.totalPoints)} vs stored ${Math.round(s.points)}`);
      if (pointsMatch && !tierMatch) tierDiffs.push(`${bucket}: recompute ${entry.tier} vs stored ${s.tier}`);
    }
    for (const [bucket] of storedByBucket) {
      if (!recomputed.has(bucket)) onlyStored.push(bucket);
    }

    console.log('\n=== mastery recompute validation (READ-ONLY) ===');
    console.log(`events: ${events.rows.length}  |  recomputed buckets: ${recomputed.size}  |  stored rows: ${stored.rows.length}`);
    console.log(`exact matches (points + tier): ${matched}`);
    console.log(`point diffs:  ${pointDiffs.length}`);
    console.log(`tier diffs:   ${tierDiffs.length}`);
    console.log(`only in recompute: ${onlyRecomputed.length}`);
    console.log(`only in stored:    ${onlyStored.length}`);

    const show = (title: string, rows: string[]) => {
      if (rows.length === 0) return;
      console.log(`\n--- ${title} (first 20) ---`);
      for (const r of rows.slice(0, 20)) console.log(`  ${r}`);
      if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`);
    };
    show('POINT DIFFS', pointDiffs);
    show('TIER DIFFS', tierDiffs);
    show('ONLY IN RECOMPUTE', onlyRecomputed);
    show('ONLY IN STORED', onlyStored);

    console.log(
      pointDiffs.length === 0 && tierDiffs.length === 0
        ? '\n✓ recompute reproduces the stored aggregate (any only-in-* rows are expected drift — inspect above).'
        : '\n⚠ diffs found — inspect before trusting the recompute for a live rebuild.',
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
