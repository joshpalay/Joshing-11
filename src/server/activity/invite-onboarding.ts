import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';

import { activityItems, db, friendInvitations, masteryEvents } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';
import {
  FIRST_FIVE_PLAY_SURFACES,
  FIRST_FIVE_THRESHOLD,
  INVITED_FRIEND_FIRST_FIVE_TYPE,
  firstFiveActivityToWrite,
} from '@/server/activity/invite-onboarding-policy';

/**
 * After an invited friend answers a question, notify the friend who invited
 * them once they've both accepted the invitation and played their first five
 * questions.
 *
 * Safe to call after every daily/Joshing answer: it self-gates on the exact
 * transition to the threshold and swallows its own errors so it never breaks
 * the answer path. The notify/skip decision lives in the pure
 * firstFiveActivityToWrite policy; this wrapper only does the DB reads.
 */
export async function maybeNotifyInviterOfFirstFive(inviteeUserId: string): Promise<void> {
  try {
    // Each daily/Joshing answer writes exactly one (deduped) MASTERY_EVENTS
    // row, so the row count is the number of distinct questions played.
    const [playedRow] = await db
      .select({ played: count() })
      .from(masteryEvents)
      .where(
        and(
          eq(masteryEvents.userId, inviteeUserId),
          inArray(masteryEvents.sessionContext, [...FIRST_FIVE_PLAY_SURFACES]),
        ),
      );
    const playedCount = Number(playedRow?.played ?? 0);

    // Cheap gate before the extra lookups: only the exact crossing matters.
    if (playedCount !== FIRST_FIVE_THRESHOLD) return;

    // Did this user join via a friend's invitation?
    const [invitationRow] = await db
      .select({
        id: friendInvitations.id,
        inviterUserId: friendInvitations.inviterUserId,
      })
      .from(friendInvitations)
      .where(
        and(
          eq(friendInvitations.inviteeUserId, inviteeUserId),
          isNotNull(friendInvitations.acceptedAt),
        ),
      )
      .limit(1);

    if (!invitationRow) return;

    // Defensive idempotency: never write the same milestone twice for one
    // invitation (covers retries and two answers that both observe count == 5).
    const [existing] = await db
      .select({ id: activityItems.id })
      .from(activityItems)
      .where(
        and(
          eq(activityItems.userId, invitationRow.inviterUserId),
          eq(activityItems.type, INVITED_FRIEND_FIRST_FIVE_TYPE),
          eq(activityItems.referenceId, invitationRow.id),
        ),
      )
      .limit(1);

    const activity = firstFiveActivityToWrite({
      inviteeUserId,
      playedCount,
      invitation: invitationRow,
      alreadyNotified: Boolean(existing),
    });
    if (!activity) return;

    await writeActivity(activity);
  } catch (error) {
    console.error('first-five inviter notification failed', error);
  }
}
