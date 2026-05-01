import type { CategoryGainsDeltaRow } from '@/server/mastery/category-gains-types';

/** PRD §8.38 — end-of-session line after daily play; domain lines mirror CategoryGainsDisplay (movement = points_earned > 0). */
export const DEFAULT_SESSION_CLOSE_COPY = 'Done for today. Your next 5 questions arrive tomorrow at noon.';

export type SessionCloseDomainRow = {
  canonical_subcategory: string;
  points_earned: number;
};

export function buildSessionCloseCopyFromDomains(rows: SessionCloseDomainRow[] | null | undefined): string {
  const withMovement = (rows ?? []).filter((row) => row.points_earned > 0);
  if (withMovement.length === 0) {
    return DEFAULT_SESSION_CLOSE_COPY;
  }

  const sorted = [...withMovement].sort(
    (a, b) => b.points_earned - a.points_earned || a.canonical_subcategory.localeCompare(b.canonical_subcategory),
  );
  const top = sorted.slice(0, 2).map((row) => row.canonical_subcategory);
  if (top.length === 1) {
    return `Done for today. You're building in ${top[0]}. Your next 5 questions arrive tomorrow at noon.`;
  }
  return `Done for today. You're building in ${top[0]} and ${top[1]}. Your next 5 questions arrive tomorrow at noon.`;
}

export function buildSessionCloseCopy(deltas: CategoryGainsDeltaRow[] | null | undefined): string {
  return buildSessionCloseCopyFromDomains(
    (deltas ?? []).map((row) => ({
      canonical_subcategory: row.subcategory,
      points_earned: row.points_earned,
    })),
  );
}
