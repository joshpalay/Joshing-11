import { and, eq } from 'drizzle-orm';

import { activityItems, db, masteryEvents, playerMastery } from '@/server/db';
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
      seasonPointsStart: 0,
      territoryType: desiredTerritoryType,
    })
    .onConflictDoNothing({ target: [playerMastery.userId, playerMastery.canonicalSubcategory] });

  return { opened: true, alreadyExisted: false, territoryType: desiredTerritoryType };
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
