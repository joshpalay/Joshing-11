import { and, desc, eq, isNull } from 'drizzle-orm';

import { biweeklyCeremonies, db } from '@/server/db';

export type BiweeklyCeremony = typeof biweeklyCeremonies.$inferSelect;

export async function getCeremonyBanner(userId: string): Promise<BiweeklyCeremony | null> {
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
