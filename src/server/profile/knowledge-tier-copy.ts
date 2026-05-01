import type { MasteryTier } from '@prisma/client';

export const KNOWLEDGE_TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
};

export const KNOWLEDGE_TIER_INTERPRETATION: Record<MasteryTier, string> = {
  establishing: 'New territory',
  familiar: "You're building here",
  solid: "You're solid here",
  mastery: 'You carry this',
};

const KNOWLEDGE_TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

export function getKnowledgeTierInterpretation(tier: MasteryTier): string {
  return KNOWLEDGE_TIER_INTERPRETATION[tier];
}

export function getNextKnowledgeTier(tier: MasteryTier): MasteryTier | null {
  const index = KNOWLEDGE_TIER_ORDER.indexOf(tier);
  if (index < 0 || index === KNOWLEDGE_TIER_ORDER.length - 1) return null;
  return KNOWLEDGE_TIER_ORDER[index + 1];
}

export function getKnowledgeTierProgressionLabel(tier: MasteryTier): string {
  const nextTier = getNextKnowledgeTier(tier);
  if (!nextTier) return KNOWLEDGE_TIER_LABEL.mastery;
  return `${KNOWLEDGE_TIER_LABEL[tier]} → ${KNOWLEDGE_TIER_LABEL[nextTier]}`;
}
