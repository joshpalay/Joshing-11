import { and, asc, eq, inArray } from 'drizzle-orm';

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
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)))
    // Selection order, oldest-declared first. saveDeclaredInterests writes the
    // onboarding picks with strictly-increasing declaredAt in selection order, so
    // this recovers "first-picked first" — the signal the first Daily Five uses to
    // weight strong- vs light-signal areas (see first-run-seeding.ts). domain is a
    // stable tiebreaker for any rows that share a timestamp (e.g. legacy saves).
    .orderBy(asc(declaredInterests.declaredAt), asc(declaredInterests.domain));

  return rows.map((row) => ({ ...row, territoryType: 'declared' as const }));
}

// Batch variant of getActiveDeclaredInterests for a SET of users in one
// `inArray` query, grouped by userId. The global order (declaredAt asc, domain
// asc) is preserved within each user's slice, so per-user consumers see the same
// "first-picked first" ordering the single-user query yields. Users with no
// active declared interests are simply absent from the map (callers default to []).
export async function getActiveDeclaredInterestsBulk(
  userIds: readonly string[],
): Promise<Map<string, ActiveDeclaredInterestRow[]>> {
  const result = new Map<string, ActiveDeclaredInterestRow[]>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return result;

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
    .where(and(inArray(declaredInterests.userId, ids), eq(declaredInterests.isActive, true)))
    .orderBy(asc(declaredInterests.declaredAt), asc(declaredInterests.domain));

  for (const row of rows) {
    const list = result.get(row.userId);
    const value: ActiveDeclaredInterestRow = { ...row, territoryType: 'declared' as const };
    if (list) list.push(value);
    else result.set(row.userId, [value]);
  }
  return result;
}
