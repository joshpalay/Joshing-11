/**
 * Refine Your Game — commit at next-daily build.
 *
 * Staged decisions (and the status-quo defaults of shown-but-unacted items)
 * become permanent when the player builds their next daily. fillDailyQueueForUser
 * calls commitPendingRefineDecisions() at its very top, before any early return.
 *
 * The flow is idempotent: staged rows are filtered by `committed_at IS NULL`, all
 * effect writes are upserts / conflict-safe, and the defaulted-cooldown insert
 * uses ON CONFLICT DO NOTHING against the unique item index.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  dailyQueues,
  dailyRefineDecisions,
  db,
  declaredInterests,
  userDomainExclusions,
} from '@/server/db';
import { freezeDomainDifficulty } from '@/server/adaptive-difficulty';
import { deriveSelectedRefineCandidates } from '@/server/db/queries/refine';
import type { QueueSlot } from '@/server/daily/types';
import type { RefineItemType } from '@/server/refine/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-type cooldown after a decision commits (defaulted or resolved). */
const COOLDOWN_MS: Record<RefineItemType, number> = {
  friend_expansion: 1 * DAY_MS,
  // Escalation re-suppression is the freeze window itself; mirror it here so the
  // heads-up doesn't re-fire while the freeze is active.
  difficulty_escalation: 30 * DAY_MS,
  struggle_pruning: 7 * DAY_MS,
};

const FREEZE_MS = 30 * DAY_MS;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

type DecisionRow = typeof dailyRefineDecisions.$inferSelect;

/** Apply the durable effect of a resolved refine decision. */
async function applyResolvedEffect(userId: string, row: DecisionRow, until: Date): Promise<void> {
  const domain = row.canonicalSubcategory;
  switch (row.itemType as RefineItemType) {
    case 'friend_expansion':
      // Promote the bonus subdomain into the owned set, and lift any prior
      // exclusion so getKnowledgeBase stops filtering it out.
      await db
        .insert(declaredInterests)
        .values({ userId, domain, isActive: true })
        .onConflictDoUpdate({
          target: [declaredInterests.userId, declaredInterests.domain],
          set: { isActive: true },
        });
      await db
        .delete(userDomainExclusions)
        .where(
          and(
            eq(userDomainExclusions.userId, userId),
            eq(userDomainExclusions.scope, 'subcategory'),
            eq(userDomainExclusions.canonicalSubcategory, domain),
          ),
        );
      return;
    case 'struggle_pruning':
      await db
        .insert(userDomainExclusions)
        .values({ userId, canonicalSubcategory: domain, scope: 'subcategory' })
        .onConflictDoNothing({
          target: [
            userDomainExclusions.userId,
            userDomainExclusions.scope,
            userDomainExclusions.canonicalSubcategory,
          ],
        });
      return;
    case 'difficulty_escalation':
      await freezeDomainDifficulty(userId, domain, until);
      return;
  }
}

export async function commitPendingRefineDecisions(userId: string): Promise<void> {
  const now = new Date();

  // 1. Apply every staged (uncommitted) decision, then stamp its cooldown.
  const pending = await db
    .select()
    .from(dailyRefineDecisions)
    .where(
      and(
        eq(dailyRefineDecisions.userId, userId),
        eq(dailyRefineDecisions.action, 'pending'),
        isNull(dailyRefineDecisions.committedAt),
      ),
    );

  for (const row of pending) {
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_MS[row.itemType as RefineItemType]);
    try {
      await applyResolvedEffect(userId, row, new Date(now.getTime() + FREEZE_MS));
    } catch (error) {
      // Leave the row uncommitted so a later build retries rather than dropping
      // a decision the player made.
      console.warn('[refine/commit] effect failed', row.itemType, row.canonicalSubcategory, error);
      continue;
    }
    await db
      .update(dailyRefineDecisions)
      .set({ action: 'committed', committedAt: now, cooldownUntil, updatedAt: now })
      .where(eq(dailyRefineDecisions.id, row.id));
  }

  // 2. Stamp default cooldowns for shown-but-unacted items on the most recent
  //    completed queue (the summary the player just saw), so the same evidence
  //    doesn't immediately re-fire. After step 1, resolved items carry an active
  //    cooldown, so re-derivation yields only the defaulted ones.
  const [priorQueue] = await db
    .select({ id: dailyQueues.id, slots: dailyQueues.slots })
    .from(dailyQueues)
    .where(
      and(
        eq(dailyQueues.userId, userId),
        sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${dailyQueues.slots}) slot
        WHERE (slot->>'answered')::boolean IS TRUE
      )`,
      ),
    )
    .orderBy(desc(dailyQueues.queueDate))
    .limit(1);

  if (!priorQueue) return;

  const defaulted = await deriveSelectedRefineCandidates(userId, asQueueSlots(priorQueue.slots));
  for (const candidate of defaulted) {
    await db
      .insert(dailyRefineDecisions)
      .values({
        userId,
        queueId: priorQueue.id,
        itemType: candidate.type,
        canonicalSubcategory: candidate.subdomainId,
        friendId: candidate.friendId ?? null,
        action: 'defaulted',
        committedAt: now,
        cooldownUntil: new Date(now.getTime() + COOLDOWN_MS[candidate.type]),
      })
      .onConflictDoNothing();
  }
}
