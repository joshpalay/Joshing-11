import { and, desc, eq, isNull } from 'drizzle-orm';

import { biweeklyCeremonies, db } from '@/server/db';

export type BiweeklyCeremony = typeof biweeklyCeremonies.$inferSelect;

/**
 * Most recent unviewed ceremony for the user, or null. Drives the pinned-card
 * state of the top-of-feed ceremony row (post-fire, pre-view). The countdown
 * state (Mon–Sat, "ceremony in N days") is computed client-side from
 * nextCeremonyAt and doesn't need a DB query.
 */
export async function getLatestUnviewedCeremony(userId: string): Promise<BiweeklyCeremony | null> {
  const [ceremony] = await db
    .select()
    .from(biweeklyCeremonies)
    .where(and(eq(biweeklyCeremonies.userId, userId), isNull(biweeklyCeremonies.viewedAt)))
    .orderBy(desc(biweeklyCeremonies.firedAt))
    .limit(1);

  return ceremony ?? null;
}

export async function getCeremonyById(ceremonyId: string): Promise<BiweeklyCeremony | null> {
  const [ceremony] = await db
    .select()
    .from(biweeklyCeremonies)
    .where(eq(biweeklyCeremonies.id, ceremonyId))
    .limit(1);

  return ceremony ?? null;
}

/**
 * Returns the next ceremony firing time: the upcoming Sunday at 08:00 UTC.
 * If `now` is already Sunday before 08:00 UTC, returns today at 08:00 UTC.
 * If Sunday after 08:00 UTC, returns next Sunday.
 */
export function getNextCeremonyAt(now: Date = new Date()): Date {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    8, 0, 0, 0,
  ));
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0) {
    // Sunday: today at 8am if still before, else next Sunday.
    if (now.getTime() < next.getTime()) return next;
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  // Other day: advance to upcoming Sunday at 8am.
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  next.setUTCDate(next.getUTCDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
  return next;
}
