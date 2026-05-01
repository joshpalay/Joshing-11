import type { MasteryTier } from '@/types/db';

/** Shape returned by `GET /api/users/:userId/mastery/round-delta` for each bucket. */
export type CategoryGainsDeltaRow = {
  subcategory: string;
  points_earned: number;
  points_from_answers: number;
  points_from_catchup: number;
  points_from_author_credit: number;
  points_from_authored: number;
  total: number;
  current_tier: MasteryTier;
  next_tier: MasteryTier;
  progress_pct: number;
  tier_crossed: boolean;
  new_tier: MasteryTier | null;
};

export function categoryGainsSourceLines(row: CategoryGainsDeltaRow): string[] {
  const lines: string[] = [];
  if (row.points_from_answers > 0) lines.push(`+${row.points_from_answers} from answers`);
  if (row.points_from_catchup > 0) lines.push(`+${row.points_from_catchup} from catch-up`);
  if (row.points_from_author_credit > 0) lines.push(`+${row.points_from_author_credit} when others got your questions right`);
  if (row.points_from_authored > 0) lines.push(`+${row.points_from_authored} from questions you wrote`);
  return lines;
}

export function formatCategoryGainLine(points: number, subcategory: string): string {
  const p = Number.isInteger(points) ? String(points) : points.toFixed(2);
  return `+${p} ${subcategory}`;
}
