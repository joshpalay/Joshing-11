import { and, eq, inArray, like, or } from 'drizzle-orm';

import {
  activityItems,
  dailyQueues,
  db,
  feedItems,
  friendInvitations,
  friendships,
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

import type { PlaytestManifest, TrackedRow } from './manifest';

function ids<K extends TrackedRow['kind']>(
  rows: TrackedRow[],
  kind: K,
): Array<Extract<TrackedRow, { kind: K }>['id']> {
  return rows
    .filter((row): row is Extract<TrackedRow, { kind: K }> => row.kind === kind)
    .map((row) => row.id);
}

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
  const userIds = ids(manifest.rows, 'user');
  const questionIds = ids(manifest.rows, 'question');
  const invitationIds = ids(manifest.rows, 'invitation');
  const friendshipIds = ids(manifest.rows, 'friendship');
  const gameIds = ids(manifest.rows, 'game');
  const dailyQueueIds = ids(manifest.rows, 'daily-queue');

  await assertTestUsersOnly(userIds);

  // FK-safe order: leaves first, then their parents.
  if (gameIds.length > 0) {
    await db.delete(joshingGameResponses).where(inArray(joshingGameResponses.gameId, gameIds));
    await db.delete(joshingGameRecipients).where(inArray(joshingGameRecipients.gameId, gameIds));
    await db.delete(joshingGameQuestions).where(inArray(joshingGameQuestions.gameId, gameIds));
    await db.delete(feedItems).where(inArray(feedItems.joshingGameId, gameIds));
  }

  if (userIds.length > 0) {
    await db.delete(feedItems).where(or(
      inArray(feedItems.recipientUserId, userIds),
      inArray(feedItems.sourceUserId, userIds),
    ));
    await db.delete(activityItems).where(or(
      inArray(activityItems.userId, userIds),
      inArray(activityItems.actorUserId, userIds),
    ));
    await db.delete(masteryEvents).where(inArray(masteryEvents.userId, userIds));
    await db.delete(playerMastery).where(inArray(playerMastery.userId, userIds));
    await db.delete(userQuestionBank).where(inArray(userQuestionBank.userId, userIds));
    await db.delete(userSessions).where(inArray(userSessions.userId, userIds));
    await db.delete(smsLogs).where(inArray(smsLogs.userId, userIds));
  }

  if (dailyQueueIds.length > 0) {
    await db.delete(dailyQueues).where(inArray(dailyQueues.id, dailyQueueIds));
  } else if (userIds.length > 0) {
    // Daily queues weren't explicitly tracked but the daily scenario may
    // have created them; wipe any belonging to our test users.
    await db.delete(dailyQueues).where(inArray(dailyQueues.userId, userIds));
  }

  if (friendshipIds.length > 0) {
    await db.delete(friendships).where(inArray(friendships.id, friendshipIds));
  }
  if (userIds.length > 0) {
    // Catch any friendship rows the scenario forgot to track explicitly
    // (e.g. created via acceptFriendInvitation's transaction).
    await db.delete(friendships).where(or(
      inArray(friendships.userAId, userIds),
      inArray(friendships.userBId, userIds),
    ));
  }

  if (invitationIds.length > 0) {
    await db.delete(friendInvitations).where(inArray(friendInvitations.id, invitationIds));
  }
  if (userIds.length > 0) {
    await db.delete(friendInvitations).where(or(
      inArray(friendInvitations.inviterUserId, userIds),
      inArray(friendInvitations.inviteeUserId, userIds),
    ));
  }

  if (questionIds.length > 0) {
    await db.delete(questions).where(inArray(questions.id, questionIds));
  }

  // OtpCode and SmsLog are phone-scoped; clear the test phone block.
  await db.delete(otpCodes).where(like(otpCodes.phoneNumber, '+15557%'));
  await db.delete(smsLogs).where(like(smsLogs.phoneNumber, '+15557%'));

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }

  // Suppress unused-import warning when no friendship rows referenced
  // (TypeScript doesn't tree-shake schema imports).
  void and;
  void eq;
}
