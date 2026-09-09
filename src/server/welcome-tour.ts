import { and, eq, isNull } from 'drizzle-orm';

import { db, dailyQueues, users } from '@/server/db';
import { isRoundComplete, type QueueSlot } from '@/server/daily/types';

export function isWelcomeTourEligible(input: {
  seenAt: Date | null;
  queues: Array<{ slots: unknown }>;
}): boolean {
  if (input.seenAt != null) return false;
  return input.queues.some(({ slots }) =>
    Array.isArray(slots) ? isRoundComplete(slots as QueueSlot[]) : false,
  );
}

/**
 * The welcome tour is earned by completing a Daily Five, not by finishing
 * account setup. Queue history makes this survive a missed redirect, refresh,
 * or later return; the user marker keeps the decision account-scoped.
 */
export async function shouldShowWelcomeTour(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ seenAt: users.welcomeTourSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.seenAt != null) return false;

  const queues = await db
    .select({ slots: dailyQueues.slots })
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId));

  return isWelcomeTourEligible({ seenAt: user.seenAt, queues });
}

export async function markWelcomeTourSeen(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ welcomeTourSeenAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.welcomeTourSeenAt)));
}
