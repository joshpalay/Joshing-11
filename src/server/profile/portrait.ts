import type { DifficultyEstimate, MasteryTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDifficultyPoints } from '@/server/mastery/awards';
import { mapCategoryToBroadCategory } from '@/lib/questions/categorization';

export type PortraitCategory = {
  canonical_subcategory: string;
  broad_category: string;
  declared_score: number;
  proven_score: number;
  proven_score_catchup: number;
  emerging_proven: boolean;
  question_count: number;
  answer_count: number;
  authored_answered_count: number;
  difficulty_breakdown: {
    declared: Record<DifficultyEstimate, number>;
    proven: Record<DifficultyEstimate, number>;
  };
};

export type PortraitResponse = {
  categories: PortraitCategory[];
  max_declared_score: number;
  max_proven_score: number;
};

export type MasteryRow = {
  canonical_subcategory: string;
  current_tier: MasteryTier;
  mastery_points: number;
  tier_reached_at: string | null;
  /** Points gained since season baseline (`total_points - season_points_start`). Own view / server use. */
  season_points_gained: number;
};

export type PortraitState = 'empty' | 'sparse' | 'developing' | 'rich';

function emptyBreakdown(): Record<DifficultyEstimate, number> {
  return { accessible: 0, moderate: 0, specialist: 0 };
}

function resolveDifficulty(value: DifficultyEstimate | null | undefined): DifficultyEstimate {
  return value ?? 'moderate';
}

export async function getPortraitData(userId: string): Promise<PortraitResponse> {
  const [questions, answers] = await Promise.all([
    prisma.question.findMany({
      where: {
        creator_id: userId,
        canonical_subcategory: { not: null },
        deleted_at: null,
      },
      select: {
        canonical_subcategory: true,
        broad_category: true,
        category: true,
        calibrated_difficulty: true,
        llm_difficulty: true,
        _count: {
          select: {
            answers: {
              where: {
                result: { not: 'expired' },
                user_id: { not: userId },
              },
            },
          },
        },
      },
    }),
    prisma.answer.findMany({
      where: {
        user_id: userId,
        result: 'correct',
        question: { canonical_subcategory: { not: null } },
      },
      select: {
        catch_up: true,
        question: {
          select: {
            canonical_subcategory: true,
            broad_category: true,
            category: true,
            calibrated_difficulty: true,
            llm_difficulty: true,
          },
        },
      },
    }),
  ]);

  const bucket = new Map<string, PortraitCategory>();

  for (const q of questions) {
    const canonical = q.canonical_subcategory?.trim();
    if (!canonical) continue;
    const broad = q.broad_category?.trim() || mapCategoryToBroadCategory(q.category);
    const difficulty = resolveDifficulty(q.calibrated_difficulty ?? q.llm_difficulty);
    // Portrait declared weight = 1.0× difficulty (PRD §8.27). The 0.75× is mastery-points only (§8.31).
    const score = getDifficultyPoints(difficulty);
    const current = bucket.get(canonical) ?? {
      canonical_subcategory: canonical,
      broad_category: broad,
      declared_score: 0,
      proven_score: 0,
      proven_score_catchup: 0,
      emerging_proven: false,
      question_count: 0,
      answer_count: 0,
      authored_answered_count: 0,
      difficulty_breakdown: {
        declared: emptyBreakdown(),
        proven: emptyBreakdown(),
      },
    };

    current.declared_score += score;
    current.question_count += 1;
    if (q._count.answers > 0) current.authored_answered_count += 1;
    current.difficulty_breakdown.declared[difficulty] += 1;
    bucket.set(canonical, current);
  }

  for (const a of answers) {
    const canonical = a.question.canonical_subcategory?.trim();
    if (!canonical) continue;
    const broad = a.question.broad_category?.trim() || mapCategoryToBroadCategory(a.question.category);
    const difficulty = resolveDifficulty(a.question.calibrated_difficulty ?? a.question.llm_difficulty);
    // Portrait proven weight: live = 1.0×, catch-up = 0.5× (D3 spec). The 0.25× is mastery-points only (§8.31).
    const score = getDifficultyPoints(difficulty) * (a.catch_up ? 0.5 : 1);
    const current = bucket.get(canonical) ?? {
      canonical_subcategory: canonical,
      broad_category: broad,
      declared_score: 0,
      proven_score: 0,
      proven_score_catchup: 0,
      emerging_proven: false,
      question_count: 0,
      answer_count: 0,
      authored_answered_count: 0,
      difficulty_breakdown: {
        declared: emptyBreakdown(),
        proven: emptyBreakdown(),
      },
    };

    current.proven_score += score;
    if (a.catch_up) current.proven_score_catchup += score;
    current.answer_count += 1;
    current.difficulty_breakdown.proven[difficulty] += 1;
    bucket.set(canonical, current);
  }

  // Hybrid gating (decision lock): canonical categories are shown when either:
  // - authored corpus is at least 3 questions, or
  // - the player has proven territory in that category (emerging proven state).
  const PORTRAIT_MIN_QUESTIONS = 3;
  const categories = Array.from(bucket.values())
    .filter((c) => c.question_count >= PORTRAIT_MIN_QUESTIONS || c.proven_score > 0)
    .map((c) => ({
      ...c,
      emerging_proven: c.question_count < PORTRAIT_MIN_QUESTIONS && c.proven_score > 0,
    }));
  const max_declared_score = categories.reduce((max, c) => Math.max(max, c.declared_score), 0);
  const max_proven_score = categories.reduce((max, c) => Math.max(max, c.proven_score), 0);

  return {
    categories,
    max_declared_score,
    max_proven_score,
  };
}

export async function getMasteryData(userId: string): Promise<MasteryRow[]> {
  const rows = await prisma.playerMastery.findMany({
    where: { user_id: userId },
    select: {
      canonical_subcategory: true,
      tier: true,
      total_points: true,
      tier_reached_at: true,
      season_points_start: true,
    },
    orderBy: [{ total_points: 'desc' }, { canonical_subcategory: 'asc' }],
  });

  return rows.map((row) => ({
    canonical_subcategory: row.canonical_subcategory,
    current_tier: row.tier,
    mastery_points: row.total_points,
    tier_reached_at: row.tier_reached_at ? row.tier_reached_at.toISOString() : null,
    season_points_gained: Math.max(0, row.total_points - row.season_points_start),
  }));
}

/** Latest daily round key for round-delta UI (`gameId:YYYY-MM-DD`). */
export async function getLatestRoundIdForUser(userId: string): Promise<string | null> {
  void userId;
  // TODO v11.0: prisma.dailyAssignment.findFirst - needs new data source
  return null;
}

export function getPortraitState(categoryCount: number): PortraitState {
  if (categoryCount <= 0) return 'empty';
  if (categoryCount <= 3) return 'sparse';
  if (categoryCount <= 10) return 'developing';
  return 'rich';
}

export function getTopCategoriesForMultitudes(
  categories: PortraitCategory[],
  masteryByCategory: Map<string, MasteryTier>,
  portraitState: PortraitState,
): Array<{ canonical_subcategory: string; tier: MasteryTier }> {
  const sorted = [...categories].sort((a, b) => (b.declared_score + b.proven_score) - (a.declared_score + a.proven_score));

  const takeCount = portraitState === 'sparse' ? 2 : portraitState === 'developing' ? 3 : 4;

  return sorted.slice(0, takeCount).map((item) => ({
    canonical_subcategory: item.canonical_subcategory,
    tier: masteryByCategory.get(item.canonical_subcategory) ?? 'establishing',
  }));
}
