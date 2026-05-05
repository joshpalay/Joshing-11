import { and, eq } from 'drizzle-orm';

import { db, declaredInterests } from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';

export type ActiveDeclaredInterestRow = {
  id: string;
  userId: string;
  domain: string;
  broadCategory: string | null;
  declaredAt: Date;
  isActive: boolean;
  territoryType: 'declared' | 'demonstrated';
};

// Returns active declared interests for a user. Falls back to a column-narrowed
// query when the territory_type column is missing on the deployed DB (migration
// 0014 not yet applied), defaulting territoryType to 'declared'.
export async function getActiveDeclaredInterests(userId: string): Promise<ActiveDeclaredInterestRow[]> {
  try {
    return await db
      .select()
      .from(declaredInterests)
      .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));
  } catch (err) {
    if (pgErrorCode(err) !== '42703') throw err;
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
}
