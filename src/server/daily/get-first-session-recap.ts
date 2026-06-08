/**
 * First-Session Recap (B-FirstRecap-1) — DB orchestration.
 *
 * Loads the signals the pure beat logic needs and assembles the recap view:
 *   • seen-signal + display name from User
 *   • first-completed-round signal from the existing daily summary
 *   • inviter resolution (FriendInvitation → User), and whether the inviter's
 *     B-HomeSeed-1 backfill placed any `friend_answered` items on the home feed
 *
 * Returns null whenever the recap must NOT fire (already seen, or not the first
 * completed round). The seen-marker is set separately when the recap is shown.
 */

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { getDailyAssignmentBounds } from '@/lib/games/timezone';
import { db, feedItems, friendInvitations, users } from '@/server/db';
import { getDailySummary } from '@/server/db/queries/daily-summary';
import { SOCIAL_FEED_SOURCE_TYPE } from '@/server/feed/visibility';
import {
  computeFirstSessionRecapBeats,
  isFirstSessionRecapEligible,
  type FirstSessionRecapView,
} from '@/server/daily/first-session-recap';

function todayAssignmentDate(): Date {
  return new Date(`${getDailyAssignmentBounds().assignmentDateStr}T00:00:00.000Z`);
}

/**
 * Assemble the first-session recap for `userId`, or null when it must not fire.
 */
export async function getFirstSessionRecap(
  userId: string,
): Promise<FirstSessionRecapView | null> {
  const [user] = await db
    .select({
      displayName: users.displayName,
      seenAt: users.firstSessionRecapSeenAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Fast exit: missing user, or the recap has already been shown.
  if (!user || user.seenAt != null) return null;

  const summary = await getDailySummary(userId, todayAssignmentDate());

  if (
    !isFirstSessionRecapEligible({
      seenAt: user.seenAt,
      isFirstCompletedRound: summary.isFirstCompletedRound,
    })
  ) {
    return null;
  }

  // Resolve the inviter (most recently accepted invitation), if any.
  const [invitation] = await db
    .select({
      inviterUserId: friendInvitations.inviterUserId,
      inviterName: users.displayName,
    })
    .from(friendInvitations)
    .leftJoin(users, eq(friendInvitations.inviterUserId, users.id))
    .where(
      and(
        eq(friendInvitations.inviteeUserId, userId),
        isNotNull(friendInvitations.acceptedAt),
      ),
    )
    .orderBy(desc(friendInvitations.acceptedAt))
    .limit(1);

  let inviter: { name: string } | null = null;
  let inviterBackfillItemCount = 0;
  if (invitation?.inviterUserId) {
    // An inviter exists even if their display name is unset; fall back to a
    // non-fabricated generic rather than dropping Beat 3 to the no-inviter copy.
    inviter = { name: invitation.inviterName?.trim() || 'Your friend' };

    // Present vs future tense keys on whether the B-HomeSeed-1 backfill actually
    // seeded the inviter's recent answers onto this user's home feed. Presence
    // (limit 1) is all we need.
    const seeded = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(
        and(
          eq(feedItems.recipientUserId, userId),
          eq(feedItems.sourceUserId, invitation.inviterUserId),
          eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
          eq(feedItems.state, 'active'),
        ),
      )
      .limit(1);
    inviterBackfillItemCount = seeded.length;
  }

  return computeFirstSessionRecapBeats({
    displayName: user.displayName,
    questions: summary.questions.map((question) => ({
      domainDisplayName: question.domainDisplayName,
      isCorrect: question.isCorrect,
      isSkipped: question.isSkipped,
    })),
    inviter,
    inviterBackfillItemCount,
  });
}

/**
 * Mark the first-session recap as seen. Idempotent: only stamps the timestamp
 * when it is still NULL, so the recap can never be re-triggered by re-entry,
 * refresh, or replaying catch-up.
 */
export async function markFirstSessionRecapSeen(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ firstSessionRecapSeenAt: new Date() })
    .where(
      and(eq(users.id, userId), isNull(users.firstSessionRecapSeenAt)),
    );
}
