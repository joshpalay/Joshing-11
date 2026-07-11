import type { DifficultyEstimate, MasteryTier } from '@/types/db';

type PortraitDifficultyEstimate = DifficultyEstimate | 'accessible' | 'moderate' | 'specialist';

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
    declared: Record<PortraitDifficultyEstimate, number>;
    proven: Record<PortraitDifficultyEstimate, number>;
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
  season_points_gained: number;
};

export type PortraitState = 'empty' | 'sparse' | 'developing' | 'rich';

// Phase 8 (friend profiles) is not built yet. These throw rather than return
// `null as unknown as X`: the cast lied to callers (a non-null type that is null
// at runtime), and returning null would be indistinguishable from a legitimate
// "empty profile". Throwing makes any accidental use fail loudly at the call site.
export async function getPortraitData(userId: string): Promise<PortraitResponse> {
  void userId;
  throw new Error('getPortraitData: not implemented (Phase 8 — friend profiles)');
}

export async function getMasteryData(userId: string): Promise<MasteryRow[]> {
  void userId;
  throw new Error('getMasteryData: not implemented (Phase 8 — friend profiles)');
}

export async function getLatestRoundIdForUser(userId: string): Promise<string | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
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
