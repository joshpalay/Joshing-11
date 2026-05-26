import { and, eq, inArray, like, or } from 'drizzle-orm';

import {
  activityItems,
  db,
  feedItems,
  friendInvitations,
  joshingGameQuestions,
  joshingGameRecipients,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  otpCodes,
  playerMastery,
  questions,
  smsLogs,
  userQuestionBank,
  userSessions,
  users,
} from '@/server/db';

import type { PlaytestManifest } from './manifest';

async function assertTestUsersOnly(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, userIds));
  const bad = rows.filter((row) => !(row.displayName ?? '').startsWith('[TEST]'));
  if (bad.length > 0) {
    throw new Error(
      `[playtest/cleanup] refusing to delete users whose display_name does not start with "[TEST]": ` +
        bad.map((b) => `${b.id}=${JSON.stringify(b.displayName)}`).join(', '),
    );
  }
}

export async function wipeTestData(manifest: PlaytestManifest): Promise<void> {
  const allUserIds = [manifest.inviter.id, ...manifest.players.map((p) => p.id)];
  const playerUserIds = manifest.players.map((p) => p.id);
  const inviterId = manifest.inviter.id;
  const gameId = manifest.gameId;
  const questionIds = manifest.questionIds;

  await assertTestUsersOnly(allUserIds);

  // Order matters: delete leaves first, then their parents.
  if (gameId) {
    await db.delete(joshingGameResponses).where(eq(joshingGameResponses.gameId, gameId));
    await db.delete(joshingGameRecipients).where(eq(joshingGameRecipients.gameId, gameId));
    await db.delete(joshingGameQuestions).where(eq(joshingGameQuestions.gameId, gameId));
    await db.delete(feedItems).where(eq(feedItems.joshingGameId, gameId));
  }

  if (allUserIds.length > 0) {
    await db.delete(feedItems).where(or(
      inArray(feedItems.recipientUserId, allUserIds),
      inArray(feedItems.sourceUserId, allUserIds),
    ));
    await db.delete(activityItems).where(or(
      inArray(activityItems.userId, allUserIds),
      inArray(activityItems.actorUserId, allUserIds),
    ));
    await db.delete(masteryEvents).where(inArray(masteryEvents.userId, allUserIds));
    await db.delete(playerMastery).where(inArray(playerMastery.userId, allUserIds));
    await db.delete(userQuestionBank).where(inArray(userQuestionBank.userId, allUserIds));
    await db.delete(userSessions).where(inArray(userSessions.userId, allUserIds));
    await db.delete(smsLogs).where(inArray(smsLogs.userId, allUserIds));
  }

  if (playerUserIds.length > 0) {
    await db.delete(friendInvitations).where(or(
      eq(friendInvitations.inviterUserId, inviterId),
      inArray(friendInvitations.inviteeUserId, playerUserIds),
    ));
  } else {
    await db.delete(friendInvitations).where(eq(friendInvitations.inviterUserId, inviterId));
  }

  if (gameId) {
    await db.delete(joshingGames).where(eq(joshingGames.id, gameId));
  }

  if (questionIds.length > 0) {
    await db.delete(questions).where(and(
      inArray(questions.id, questionIds),
      eq(questions.creatorId, inviterId),
    ));
  }

  // OtpCode rows are keyed by phone, not user — match by the [TEST] phone block.
  await db.delete(otpCodes).where(like(otpCodes.phoneNumber, '+15557%'));
  await db.delete(smsLogs).where(like(smsLogs.phoneNumber, '+15557%'));

  if (allUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, allUserIds));
  }
}
