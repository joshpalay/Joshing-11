import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';

const TIER_ORDER = ['establishing', 'familiar', 'solid', 'mastery'] as const;

export function getAxisPosition(masteryPoints: number): number {
  const { tier, progressWithinTier } = getMasteryTierDisplay(masteryPoints);
  const tierIndex = TIER_ORDER.indexOf(tier);
  const bandFloor = tierIndex * 0.25;
  const bandWidth = 0.25;
  return bandFloor + (progressWithinTier * bandWidth);
}
