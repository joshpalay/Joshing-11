/**
 * One-off backfill for the friend-request-sync bug (claude/friend-request-sync-
 * bug). A follow_request / friend_request activity row outlives its backing edge
 * when a pending request is resolved: the edge flips pending->approved on accept
 * (the case actually seen in prod) or is hard-deleted on decline/cancel. The row
 * lingers and keeps rendering "{actor} wants to be friends" with no live pending
 * edge behind it.
 *
 * The code fix soft-deletes these rows going forward (accept/decline/cancel) and
 * build-stream filters any that slip through. This script clears the rows that
 * already leaked, using the SAME predicate: a follow_request/friend_request whose
 * backing edge is missing OR no longer `pending`.
 *
 * Soft-delete only (sets deletedAt); reversible.
 *
 * Usage:
 *   npx tsx scripts/soft-delete-stale-follow-request-activity.ts            # dry-run
 *   npx tsx scripts/soft-delete-stale-follow-request-activity.ts --apply
 */

import 'dotenv/config';

import { and, inArray, isNull } from 'drizzle-orm';

import { activityItems, db, follows, friendships } from '../src/server/db';

const REQUEST_TYPES = ['follow_request', 'friend_request'] as const;
const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] No changes will be made. Pass --apply to mutate.');
  }

  // All live request rows. Tiny table slice; fetch and partition in JS rather
  // than hand-rolling a two-table anti-join.
  const rows = await db
    .select({
      id: activityItems.id,
      type: activityItems.type,
      referenceType: activityItems.referenceType,
      referenceId: activityItems.referenceId,
    })
    .from(activityItems)
    .where(and(inArray(activityItems.type, REQUEST_TYPES as readonly string[]), isNull(activityItems.deletedAt)));

  if (rows.length === 0) {
    console.log('No live follow_request/friend_request rows. Nothing to do.');
    return;
  }

  // Live `follows` rows reference the follows table; legacy `friendship` rows
  // reference the frozen friendships table. A row is stale unless its backing
  // edge still exists AND is `pending`.
  const followIds = rows
    .filter((r) => r.referenceType === 'follow' && r.referenceId)
    .map((r) => r.referenceId!);
  const friendshipIds = rows
    .filter((r) => r.referenceType === 'friendship' && r.referenceId)
    .map((r) => r.referenceId!);

  const pendingFollowIds = new Set<string>();
  if (followIds.length > 0) {
    const edges = await db
      .select({ id: follows.id, state: follows.state })
      .from(follows)
      .where(inArray(follows.id, [...new Set(followIds)]));
    for (const e of edges) if (e.state === 'pending') pendingFollowIds.add(e.id);
  }

  const pendingFriendshipIds = new Set<string>();
  if (friendshipIds.length > 0) {
    const edges = await db
      .select({ id: friendships.id, status: friendships.status })
      .from(friendships)
      .where(inArray(friendships.id, [...new Set(friendshipIds)]));
    for (const e of edges) if (e.status === 'pending') pendingFriendshipIds.add(e.id);
  }

  const stale = rows.filter((r) => {
    if (r.referenceType === 'follow') return !(r.referenceId && pendingFollowIds.has(r.referenceId));
    if (r.referenceType === 'friendship') return !(r.referenceId && pendingFriendshipIds.has(r.referenceId));
    return true; // no resolvable backing edge → stale
  });

  console.log(`${rows.length} live request row(s); ${stale.length} stale.`);
  for (const r of stale) {
    console.log(`  will soft-delete ${r.id} | ${r.type} | ${r.referenceType}:${r.referenceId}`);
  }

  if (DRY_RUN || stale.length === 0) return;

  const updated = await db
    .update(activityItems)
    .set({ deletedAt: new Date() })
    .where(and(inArray(activityItems.id, stale.map((r) => r.id)), isNull(activityItems.deletedAt)))
    .returning({ id: activityItems.id });

  console.log(`Soft-deleted ${updated.length} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
