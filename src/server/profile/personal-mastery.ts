import type { MasteryTier } from '@/types/db';
import { resolveTier } from '@/server/mastery/tiers';
import type { PortraitCategory } from '@/server/profile/portrait';
import { B5_PERSONAL_MASTERY_COPY } from '@/server/profile/personal-mastery-copy';

export type FriendOverlap = {
  has_played_here: boolean;
  has_correct_here: boolean;
  questions_answered: number;
  questions_correct: number;
  overlap_top_peer_name: string | null;
};

export type CategoryRow = PortraitCategory & { visitor_overlap?: FriendOverlap };

export function tierRank(tier: MasteryTier): number {
  if (tier === 'mastery') return 0;
  if (tier === 'solid') return 1;
  if (tier === 'familiar') return 2;
  return 3;
}

export function sortCategoriesByTierThenActivity(
  categories: CategoryRow[],
  masteryPointsByCategory: Map<string, number>,
): CategoryRow[] {
  return [...categories].sort((a, b) => {
    const rankA = tierRank(resolveTier(masteryPointsByCategory.get(a.canonical_subcategory) ?? 0));
    const rankB = tierRank(resolveTier(masteryPointsByCategory.get(b.canonical_subcategory) ?? 0));
    if (rankA !== rankB) return rankA - rankB;
    return b.declared_score + b.proven_score - (a.declared_score + a.proven_score);
  });
}

export function groupCategoriesByBroadCategory(
  sortedCategories: CategoryRow[],
): Array<[string, CategoryRow[]]> {
  const groups = new Map<string, CategoryRow[]>();
  for (const item of sortedCategories) {
    const key = item.broad_category || 'General Knowledge';
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).sort((a, b) => {
    const topA = Math.max(...a[1].map((item) => item.declared_score + item.proven_score));
    const topB = Math.max(...b[1].map((item) => item.declared_score + item.proven_score));
    return topB - topA;
  });
}

/** D2 + B10: no overlap line when the visitor has not played in this category. */
export function getFriendOverlapLine(overlap?: FriendOverlap): string | null {
  if (!overlap || !overlap.has_played_here) return null;
  if (overlap.has_correct_here) {
    const peer = overlap.overlap_top_peer_name?.trim();
    if (peer) return B5_PERSONAL_MASTERY_COPY.overlapLabels.overlapTopPeer(peer);
    return B5_PERSONAL_MASTERY_COPY.overlapLabels.knowTerritoryToo;
  }
  return B5_PERSONAL_MASTERY_COPY.overlapLabels.stillFindingFooting;
}

export function getResponsiveAxisLabel(label: 'declared' | 'proven', isNarrow: boolean): string {
  if (!isNarrow) return B5_PERSONAL_MASTERY_COPY.axisLabels.full[label];
  return B5_PERSONAL_MASTERY_COPY.axisLabels.compact[label];
}
