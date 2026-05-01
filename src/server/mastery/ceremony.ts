import { resolveTier } from '@/server/mastery/tiers';

// TODO R2: replace Prisma transaction/client shapes with Drizzle equivalents.
type DbClient = any;

type MasteryMovementInput = {
  userId: string;
  from?: Date;
  to?: Date;
};

export async function getCategoryTotals(db: DbClient, userId: string) {
  return db.playerMastery.findMany({
    where: { user_id: userId },
    select: {
      canonical_subcategory: true,
      total_points: true,
      tier: true,
      updated_at: true,
    },
    orderBy: [
      { total_points: 'desc' },
      { canonical_subcategory: 'asc' },
    ],
  });
}

export async function getTopCategoriesPerPlayer(db: DbClient, userId: string, limit = 3) {
  const totals = await getCategoryTotals(db, userId);
  return totals.slice(0, Math.max(0, limit));
}

export async function getStrongestCategory(db: DbClient, userId: string) {
  const strongest = await db.playerMastery.findFirst({
    where: { user_id: userId },
    select: {
      canonical_subcategory: true,
      total_points: true,
      tier: true,
      updated_at: true,
    },
    orderBy: [
      { total_points: 'desc' },
      { updated_at: 'desc' },
      { canonical_subcategory: 'asc' },
    ],
  });

  return strongest;
}

export async function getMasteryMovement(db: DbClient, input: MasteryMovementInput) {
  // TODO R2: replace Prisma.MasteryEventWhereInput with Drizzle equivalent
  const where: {
    user_id: string;
    created_at?: {
      gte?: Date;
      lte?: Date;
    };
  } = {
    user_id: input.userId,
    ...(input.from || input.to
      ? {
          created_at: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
  };

  const events = await db.masteryEvent.findMany({
    where,
    select: {
      canonical_subcategory: true,
      awarded_points: true,
    },
  });

  const deltaBySubcategory = new Map<string, number>();
  for (const event of events) {
    const next = (deltaBySubcategory.get(event.canonical_subcategory) ?? 0) + event.awarded_points;
    deltaBySubcategory.set(event.canonical_subcategory, next);
  }

  const subcategories = [...deltaBySubcategory.keys()];
  if (subcategories.length === 0) {
    return [];
  }

  const afterRows: Array<{
    canonical_subcategory: string;
    total_points: number;
    tier: ReturnType<typeof resolveTier>;
  }> = await db.playerMastery.findMany({
    where: {
      user_id: input.userId,
      canonical_subcategory: { in: subcategories },
    },
    select: {
      canonical_subcategory: true,
      total_points: true,
      tier: true,
    },
  });

  const afterBySubcategory = new Map(
    afterRows.map((row) => [row.canonical_subcategory, row])
  );

  return subcategories
    .map((subcategory) => {
      const pointsDelta = deltaBySubcategory.get(subcategory) ?? 0;
      const after = afterBySubcategory.get(subcategory);
      const afterPoints = after?.total_points ?? pointsDelta;
      const beforePoints = Math.max(0, afterPoints - pointsDelta);

      return {
        canonical_subcategory: subcategory,
        points_before: beforePoints,
        points_after: afterPoints,
        points_delta: pointsDelta,
        tier_before: resolveTier(beforePoints),
        tier_after: after?.tier ?? resolveTier(afterPoints),
      };
    })
    .sort((a, b) => b.points_delta - a.points_delta || a.canonical_subcategory.localeCompare(b.canonical_subcategory));
}
