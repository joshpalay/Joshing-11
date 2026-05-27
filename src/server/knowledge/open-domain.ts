import { and, eq, sql } from 'drizzle-orm';

import { activityItems, db, masteryEvents, playerMastery, questions } from '@/server/db';
import type { ActivityItemType } from '@/server/activity/write-activity';

type TerritoryType = 'declared' | 'demonstrated';

export async function openKBDomain(params: {
  userId: string;
  domain: string;
  via: 'friend_answered' | 'authorship' | 'onboarding' | 'answered_correctly';
  broadCategory?: string | null;
  questionId?: string;
}): Promise<{ opened: boolean; alreadyExisted: boolean; territoryType: TerritoryType }> {
  const desiredTerritoryType: TerritoryType = params.via === 'authorship' ? 'declared' : 'demonstrated';

  const [existing] = await db
    .select({ id: playerMastery.id, territoryType: playerMastery.territoryType })
    .from(playerMastery)
    .where(and(
      eq(playerMastery.userId, params.userId),
      eq(playerMastery.canonicalSubcategory, params.domain),
    ))
    .limit(1);

  if (existing) {
    return { opened: false, alreadyExisted: true, territoryType: existing.territoryType };
  }

  await db
    .insert(playerMastery)
    .values({
      userId: params.userId,
      canonicalSubcategory: params.domain,
      broadCategory: params.broadCategory ?? null,
      totalPoints: 0,
      tier: 'establishing',
      lifetimePointsBaseline: 0,
      territoryType: desiredTerritoryType,
    })
    .onConflictDoNothing({ target: [playerMastery.userId, playerMastery.canonicalSubcategory] });

  return { opened: true, alreadyExisted: false, territoryType: desiredTerritoryType };
}

/**
 * Self-healing reconciliation: for every Question this user has authored,
 * ensure a PLAYER_MASTERY row exists with territory_type='declared'.
 *
 * Why this exists: /api/questions calls openKBDomain inside a try/catch
 * (route.ts:358) so a transient blip there doesn't block the question
 * save. The trade-off is that on failure the Question lands without its
 * territory row, and any future correct answer in that domain is silently
 * skipped by the daily-answer "bot questions can only deepen existing
 * territories" guard (see src/app/api/daily/answer/route.ts:295).
 *
 * Running this on every /api/knowledge GET means a user who orphans a
 * domain via that failure path self-heals the next time they visit their
 * knowledge map. Idempotent — when there's nothing to backfill, this is
 * a single LEFT JOIN with no INSERT.
 */
export async function ensureAuthoredDomainsOpened(userId: string): Promise<number> {
  // Insert a 'declared' row for every distinct canonical_subcategory the
  // user has authored that doesn't already have a PLAYER_MASTERY row.
  // SELECT…ON CONFLICT keeps the call race-safe even if openKBDomain is
  // executing concurrently from another route.
  const result = await db.execute(sql`
    INSERT INTO ${playerMastery} (
      "user_id", "canonical_subcategory", "broad_category",
      "total_points", "tier", "territory_type", "lifetime_points_baseline"
    )
    SELECT
      ${userId},
      q."canonical_subcategory",
      MAX(q."broad_category"),
      0,
      'establishing'::"MasteryTier",
      'declared'::"TerritoryType",
      0
    FROM ${questions} q
    LEFT JOIN ${playerMastery} pm
      ON pm."user_id" = q."creator_id"
     AND pm."canonical_subcategory" = q."canonical_subcategory"
    WHERE q."creator_id" = ${userId}
      AND q."canonical_subcategory" IS NOT NULL
      AND q."deleted_at" IS NULL
      AND pm."id" IS NULL
    GROUP BY q."canonical_subcategory"
    ON CONFLICT ("user_id", "canonical_subcategory") DO NOTHING
  `);

  const inserted = typeof result.rowCount === 'number' ? result.rowCount : 0;
  if (inserted > 0) {
    console.info('[ensureAuthoredDomainsOpened] reconciled', {
      userId,
      backfilled: inserted,
    });
  }
  return inserted;
}

export async function promoteDeclaredToDemonstrated(params: {
  userId: string;
  domain: string;
  triggeringFriendId: string;
  questionId: string;
}): Promise<
  | { promoted: true }
  | { promoted: false; reason: 'no_row' | 'already_demonstrated' | 'error' }
> {
  try {
    const [row] = await db
      .select({ id: playerMastery.id, territoryType: playerMastery.territoryType })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, params.userId),
        eq(playerMastery.canonicalSubcategory, params.domain),
      ))
      .limit(1);

    if (!row) {
      console.warn('[promoteDeclaredToDemonstrated] no PlayerMastery row', {
        userId: params.userId,
        domain: params.domain,
        triggeringFriendId: params.triggeringFriendId,
        questionId: params.questionId,
      });
      return { promoted: false, reason: 'no_row' };
    }

    if (row.territoryType === 'demonstrated') {
      return { promoted: false, reason: 'already_demonstrated' };
    }

    await db
      .update(playerMastery)
      .set({ territoryType: 'demonstrated', updatedAt: new Date() })
      .where(and(
        eq(playerMastery.userId, params.userId),
        eq(playerMastery.canonicalSubcategory, params.domain),
      ));

    const answerId = `declared_promoted:${params.domain}:${params.questionId}:${params.triggeringFriendId}`;

    await db
      .insert(masteryEvents)
      .values({
        userId: params.userId,
        canonicalSubcategory: params.domain,
        sourceType: 'declared_promoted',
        questionId: params.questionId,
        answeredByUserId: params.triggeringFriendId,
        answerId,
        basePoints: 0,
        weight: 0,
        awardedPoints: 0,
        sessionContext: 'declared_promoted',
        metadata: { byUserId: params.triggeringFriendId, domain: params.domain },
      })
      .onConflictDoNothing({ target: masteryEvents.answerId });

    await db.insert(activityItems).values({
      userId: params.userId,
      type: 'declared_promoted' satisfies ActivityItemType,
      actorUserId: params.triggeringFriendId,
      referenceId: params.questionId,
      referenceType: 'question',
      read: false,
    });

    return { promoted: true };
  } catch (error) {
    console.warn('[promoteDeclaredToDemonstrated] promotion failed', {
      userId: params.userId,
      domain: params.domain,
      triggeringFriendId: params.triggeringFriendId,
      questionId: params.questionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { promoted: false, reason: 'error' };
  }
}
