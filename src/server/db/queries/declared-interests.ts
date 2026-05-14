import { and, eq } from 'drizzle-orm';

import { db, declaredInterests } from '@/server/db';

export type ActiveDeclaredInterestRow = {
  id: string;
  userId: string;
  domain: string;
  broadCategory: string | null;
  declaredAt: Date;
  isActive: boolean;
  territoryType: 'declared' | 'demonstrated';
};

// DeclaredInterest is now only the user's editable interest list. Territory
// state lives on PLAYER_MASTERY, so keep this query column-narrowed and never
// select the legacy DeclaredInterest.territory_type column. Some deployed
// databases do not have that column, and selecting it breaks onboarding saves.
export async function getActiveDeclaredInterests(userId: string): Promise<ActiveDeclaredInterestRow[]> {
  const rows = await db
    .select({
      id: declaredInterests.id,
      userId: declaredInterests.userId,
      domain: declaredInterests.domain,
      broadCategory: declaredInterests.broadCategory,
      declaredAt: declaredInterests.declaredAt,
      isActive: declaredInterests.isActive,
    })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));

  return rows.map((row) => ({ ...row, territoryType: 'declared' as const }));
}
