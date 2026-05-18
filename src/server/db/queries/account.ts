import { count, countDistinct, eq, sql } from 'drizzle-orm';

import {
  db,
  joshingGameResponses,
  joshingGames,
  playerMastery,
  questions,
  users,
} from '@/server/db';
import { getTierForPoints } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

export type UserProfile = {
  id: string;
  displayName: string;
  phoneNumber: string;
  createdAt: string;
  totalPoints: number;
  currentTier: string;
  questionsAuthored: number;
  gamesCreated: number;
  gamesPlayed: number;
};

const TIER_LABELS: Record<MasteryTier, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
};

function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  const lastFour = digits.slice(-4).padStart(4, '*');

  if (digits.length >= 11 && digits.startsWith('1')) {
    return `+1 (***) ***-${lastFour}`;
  }

  return `(***) ***-${lastFour}`;
}

function fallbackDisplayName(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  const lastFour = digits.slice(-4);
  return lastFour ? `Player ${lastFour}` : 'Player';
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  const [pointsResult, authoredResult, createdResult, playedResult] = await Promise.all([
    db
      .select({ totalPoints: sql<number>`coalesce(sum(${playerMastery.totalPoints}), 0)` })
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId)),
    db
      .select({ value: count() })
      .from(questions)
      .where(sql`${questions.creatorId} = ${userId} and ${questions.deletedAt} is null`),
    db
      .select({ value: count() })
      .from(joshingGames)
      .where(eq(joshingGames.creatorId, userId)),
    db
      .select({ value: countDistinct(joshingGameResponses.gameId) })
      .from(joshingGameResponses)
      .where(eq(joshingGameResponses.userId, userId)),
  ]);

  const totalPoints = Math.round(Number(pointsResult[0]?.totalPoints ?? 0));
  const tier = getTierForPoints(totalPoints);

  return {
    id: user.id,
    displayName: user.displayName?.trim() || fallbackDisplayName(user.phoneNumber),
    phoneNumber: maskPhoneNumber(user.phoneNumber),
    createdAt: user.createdAt.toISOString(),
    totalPoints,
    currentTier: TIER_LABELS[tier],
    questionsAuthored: Number(authoredResult[0]?.value ?? 0),
    gamesCreated: Number(createdResult[0]?.value ?? 0),
    gamesPlayed: Number(playedResult[0]?.value ?? 0),
  };
}

export async function updateDisplayName(params: {
  userId: string;
  displayName: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const displayName = params.displayName.trim();

  if (displayName.length < 2 || displayName.length > 30) {
    return { ok: false, reason: 'invalid' };
  }

  await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, params.userId));

  return { ok: true };
}


export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from "FeedItem" where "recipientUserId" = ${userId} or "sourceUserId" = ${userId} or "joshingGameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "ActivityItem" where "userId" = ${userId}`);
    await tx.execute(sql`update "ActivityItem" set "actorUserId" = null where "actorUserId" = ${userId}`);

    const questionReactionColumnsResult = await tx.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'QuestionReaction'
        and column_name in ('senderUserId', 'recipientUserId', 'questionId', 'answerer_id', 'creator_id', 'question_id')
    `);
    const questionReactionColumnNames = new Set(
      questionReactionColumnsResult.rows.map((row) => row.column_name),
    );

    if (
      questionReactionColumnNames.has('senderUserId')
      && questionReactionColumnNames.has('recipientUserId')
      && questionReactionColumnNames.has('questionId')
    ) {
      await tx.execute(sql`delete from "QuestionReaction" where "senderUserId" = ${userId} or "recipientUserId" = ${userId} or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    } else if (
      questionReactionColumnNames.has('answerer_id')
      && questionReactionColumnNames.has('creator_id')
      && questionReactionColumnNames.has('question_id')
    ) {
      await tx.execute(sql`delete from "QuestionReaction" where "answerer_id" = ${userId} or "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    }
    const creatorNoteTableResult = await tx.execute<{ exists: boolean }>(sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'CreatorNote'
      ) as "exists"
    `);

    if (creatorNoteTableResult.rows[0]?.exists) {
      await tx.execute(sql`delete from "CreatorNote" where "authorUserId" = ${userId} or "recipientUserId" = ${userId} or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    }

    await tx.execute(sql`delete from "GradeDispute" where "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);

    await tx.execute(sql`delete from "JoshingGameResponse" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGameRecipient" where "userId" = ${userId} or "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGameQuestion" where "gameId" in (select id from "JoshingGame" where "creatorId" = ${userId}) or "questionId" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "JoshingGame" where "creatorId" = ${userId}`);

    await tx.execute(sql`delete from "Friendship" where "userAId" = ${userId} or "userBId" = ${userId} or "requestedByUserId" = ${userId} or "removedByUserId" = ${userId}`);
    await tx.execute(sql`delete from "FriendInvitation" where "inviterUserId" = ${userId}`);
    await tx.execute(sql`update "FriendInvitation" set "inviteeUserId" = null where "inviteeUserId" = ${userId}`);
    await tx.execute(sql`update "DailyPreference" set "friend_ids" = array_remove("friend_ids", ${userId}) where ${userId} = any("friend_ids")`);

    await tx.execute(sql`delete from "SkippedDailyQuestion" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId}) or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "DailyQueue" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "DailyPreference" where "user_id" = ${userId}`);

    await tx.execute(sql`delete from "QuestionFeedback" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId}) or "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "QuestionRating" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "UserQuestionBank" where "user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "QuestionAudienceTag" where "creator_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);
    await tx.execute(sql`delete from "MASTERY_EVENTS" where "user_id" = ${userId} or "answered_by_user_id" = ${userId} or "question_id" in (select id from "Question" where "creator_id" = ${userId})`);

    await tx.execute(sql`delete from "Question" where "creator_id" = ${userId}`);
    await tx.execute(sql`update "Question" set "generated_question_id" = null where "generated_question_id" in (select id from "GeneratedQuestion" where "user_id" = ${userId})`);
    await tx.execute(sql`delete from "GeneratedQuestion" where "user_id" = ${userId}`);

    await tx.execute(sql`delete from "PLAYER_MASTERY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "CritiqueUsageDaily" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "USER_DOMAIN_DIFFICULTY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "USER_DOMAIN_EXCLUSIONS" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "PROFILE_DOMAIN_VISIBILITY" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "DeclaredInterest" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "FeedDismissedDomain" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "BiweeklyCeremony" where "userId" = ${userId}`);
    await tx.execute(sql`delete from "SmsLog" where "user_id" = ${userId}`);
    await tx.execute(sql`delete from "UserSession" where "user_id" = ${userId}`);

    await tx.delete(users).where(eq(users.id, userId));
  });
}
