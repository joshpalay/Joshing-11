import { and, eq, isNotNull, isNull, ne, or, lt } from 'drizzle-orm';

import { db } from '@/server/db';
import { users } from '@/server/db/schema';

export type WeeklyDigestRecipient = {
  id: string;
  email: string;
  weeklyDigestSentAt: Date | null;
};

/**
 * Everyone who may get the weekly friends email: a CONFIRMED address, the
 * weekly switch on, not unsubscribed from email, and not already sent within
 * the last six days (six, not seven, so a cron that drifts a little late
 * doesn't skip a whole week).
 */
export async function getWeeklyDigestRecipients(now: Date): Promise<WeeklyDigestRecipient[]> {
  const cutoff = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: users.id, email: users.email, weeklyDigestSentAt: users.weeklyDigestSentAt })
    .from(users)
    .where(
      and(
        eq(users.onboardingComplete, true),
        eq(users.emailVerified, true),
        isNotNull(users.email),
        ne(users.emailOptIn, 'opted_out'),
        eq(users.weeklyDigestOptIn, true),
        or(isNull(users.weeklyDigestSentAt), lt(users.weeklyDigestSentAt, cutoff)),
      ),
    );
  return rows.filter((r): r is WeeklyDigestRecipient => Boolean(r.email));
}

/**
 * Atomically claim this week's send. Succeeds only if weekly_digest_sent_at is
 * still the value we read, so an overlapping or retried run loses the race
 * instead of sending twice.
 */
export async function claimWeeklyDigest(
  userId: string,
  previousSentAt: Date | null,
  now: Date,
): Promise<boolean> {
  const claimed = await db
    .update(users)
    .set({ weeklyDigestSentAt: now })
    .where(
      and(
        eq(users.id, userId),
        previousSentAt === null
          ? isNull(users.weeklyDigestSentAt)
          : eq(users.weeklyDigestSentAt, previousSentAt),
      ),
    )
    .returning({ id: users.id });
  return claimed.length > 0;
}

/** Undo a claim after a failed send so the next run can retry. */
export async function releaseWeeklyDigest(userId: string, previousSentAt: Date | null): Promise<void> {
  await db
    .update(users)
    .set({ weeklyDigestSentAt: previousSentAt })
    .where(eq(users.id, userId));
}
