import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';

import { activityItems, db, friendInvitations, masteryEvents } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';

// A newly invited friend "playing their first five questions" is counted
// across the two surfaces a new user actually plays through: the daily queue
// and Joshing Games. MASTERY_EVENTS.session_context holds the originating
// surface (source_type holds the live/catchup discriminator instead), so we
// match on session_context.
const FIRST_FIVE_PLAY_SURFACES = ['daily', 'joshing_game'] as const;
const FIRST_FIVE_THRESHOLD = 5;

/**
 * After an invited friend answers a question, notify the friend who invited
 * them once they've both accepted the invitation and played their first five
 * questions.
 *
 * Safe to call after every daily/Joshing answer: it self-gates on the exact
 * transition to the threshold and swallows its own errors so it never breaks
 * the answer path.
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

    // Fire only on the exact crossing so the inviter is notified once, not on
    // every subsequent answer.
    if (Number(playedRow?.played ?? 0) !== FIRST_FIVE_THRESHOLD) return;

    // Did this user join via a friend's invitation?
    const [invitation] = await db
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

    if (!invitation?.inviterUserId) return;

    // Defensive idempotency: never write the same milestone twice for one
    // invitation (covers retries and two answers that both observe count == 5).
    const [existing] = await db
      .select({ id: activityItems.id })
      .from(activityItems)
      .where(
        and(
          eq(activityItems.userId, invitation.inviterUserId),
          eq(activityItems.type, 'invited_friend_played_first_five'),
          eq(activityItems.referenceId, invitation.id),
        ),
      )
      .limit(1);

    if (existing) return;

    await writeActivity({
      userId: invitation.inviterUserId,
      type: 'invited_friend_played_first_five',
      actorUserId: inviteeUserId,
      referenceId: invitation.id,
      referenceType: 'friend_invitation',
    });
  } catch (error) {
    console.error('first-five inviter notification failed', error);
  }
}
