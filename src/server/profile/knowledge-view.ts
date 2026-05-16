import { normalizeBroadCategory } from '@/lib/knowledge/broad-category'
import type { DomainMastery } from '@/server/db/queries/knowledge'
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug'
import type { MasteryTier } from '@/types/db'

import type { PortraitEntry } from '@/components/knowledge/PortraitCircles'
import type { KnowledgeDomainCircle } from '@/components/knowledge/KnowledgeCard'

export function asTier(value: string): MasteryTier {
  if (value === 'familiar' || value === 'solid' || value === 'mastery') {
    return value
  }
  return 'establishing'
}

export function toPortraitEntry(domain: DomainMastery): PortraitEntry {
  return {
    canonicalSubcategory: domain.displayName,
    broadCategory:
      normalizeBroadCategory(domain.broadCategory) ?? 'General Knowledge',
    totalMasteryPoints: Math.max(
      domain.points,
      domain.isDeclaredInterest ? 1 : 0
    ),
    tier: asTier(domain.tier),
    authoredAnsweredCount: domain.questionsAnswered,
  }
}

export function toKnowledgeCardDomain(
  domain: DomainMastery
): KnowledgeDomainCircle {
  return {
    canonicalSubcategory: domain.displayName,
    canonicalSubcategorySlug: toCanonicalDomainSlug(domain.domain),
    currentTier: asTier(domain.tier),
    lifetimePoints: domain.points,
    iconKey: domain.iconKey,
    broadCategory: domain.broadCategory,
  }
}

export function topPointPositiveDomains(
  domains: DomainMastery[],
  limit = 5
): DomainMastery[] {
  return [...domains]
    .sort(
      (a, b) =>
        b.points - a.points || a.displayName.localeCompare(b.displayName)
    )
    .filter((domain) => domain.points > 0)
    .slice(0, limit)
}
