import { and, eq, sql } from 'drizzle-orm';

import { activityItems, db, declaredInterests } from '@/server/db';
import type { ActivityItemType } from '@/server/activity/write-activity';

export async function openKBDomain(params: {
  userId: string;
  domain: string;
  via: 'friend_answered' | 'authorship' | 'onboarding';
  broadCategory?: string | null;
  questionId?: string;
}): Promise<{ opened: boolean; alreadyExisted: boolean }> {
  const existing = await db
    .select({ id: declaredInterests.id })
    .from(declaredInterests)
    .where(and(
      eq(declaredInterests.userId, params.userId),
      eq(declaredInterests.domain, params.domain),
      eq(declaredInterests.isActive, true),
    ))
    .limit(1);

  if (existing.length > 0) {
    return { opened: false, alreadyExisted: true };
  }

  const territoryType: 'declared' | 'demonstrated' =
    params.via === 'authorship' ? 'declared' : 'demonstrated';

  await db
    .insert(declaredInterests)
    .values({
      userId: params.userId,
      domain: params.domain,
      broadCategory: params.broadCategory ?? null,
      territoryType,
      isActive: true,
    })
    .onConflictDoNothing({ target: [declaredInterests.userId, declaredInterests.domain] });

  return { opened: true, alreadyExisted: false };
}

export async function promoteDeclaredToDemonstrated(params: {
  userId: string;
  domain: string;
  triggeringFriendId: string;
  questionId: string;
}): Promise<{ promoted: boolean }> {
  const [row] = await db
    .select({ id: declaredInterests.id, territoryType: declaredInterests.territoryType })
    .from(declaredInterests)
    .where(and(
      eq(declaredInterests.userId, params.userId),
      eq(declaredInterests.domain, params.domain),
      eq(declaredInterests.isActive, true),
    ))
    .limit(1);

  if (!row || row.territoryType !== 'declared') {
    return { promoted: false };
  }

  await db
    .update(declaredInterests)
    .set({ territoryType: 'demonstrated' })
    .where(and(
      eq(declaredInterests.userId, params.userId),
      eq(declaredInterests.domain, params.domain),
    ));

  const answerId = `declared_promoted:${params.domain}:${params.questionId}:${params.triggeringFriendId}`;

  try {
    await db.execute(sql`
      insert into "MASTERY_EVENTS" (
        "user_id", "canonical_subcategory", "source_type",
        "question_id", "answered_by_user_id", "answer_id",
        "base_points", "weight", "awarded_points", "session_context"
      ) values (
        ${params.userId}, ${params.domain}, 'declared_promoted',
        ${params.questionId}, ${params.triggeringFriendId}, ${answerId},
        0, 0, 0, 'declared_promoted'
      )
      on conflict ("answer_id") do nothing
    `);
  } catch {
    // Non-fatal — traceability only
  }

  try {
    await db.insert(activityItems).values({
      userId: params.userId,
      type: 'declared_promoted' satisfies ActivityItemType,
      actorUserId: params.triggeringFriendId,
      referenceId: params.questionId,
      referenceType: 'question',
      read: false,
    });
  } catch {
    // Non-fatal
  }

  return { promoted: true };
}
