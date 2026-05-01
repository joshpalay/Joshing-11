import { getKnowledgeTierInterpretation } from '@/server/profile/knowledge-tier-copy';
import type { DomainDetail, KnowledgeDomain, KnowledgeOverview } from '@/server/profile/knowledge-types';
import type { MasteryTier } from '@/types/db';

export function buildSpiderGraphInterpretation(domains: KnowledgeDomain[]): string | null {
  const topDomains = domains.slice(0, 6);
  if (topDomains.length === 0) return null;

  const strongest = topDomains[0];
  const developing =
    [...topDomains].reverse().find((domain) => domain.tier === 'establishing' || domain.tier === 'familiar') ??
    topDomains.find((domain) => domain.name !== strongest.name);

  const firstSentence = `Your strongest territory is ${strongest.name}.`;
  const secondSentence = developing
    ? `You're still building in ${developing.name}.`
    : `${strongest.name} is setting the direction of your map right now.`;

  return [firstSentence, secondSentence].join(' ');
}

export async function getKnowledgeOverview(userId: string): Promise<KnowledgeOverview> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
  return null as any;
}

export async function getDomainDetail(userId: string, domainName: string): Promise<DomainDetail | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
  void domainName;
  return null as any;
}

export async function setDomainVisibility(params: { userId: string; domainName: string; isVisible: boolean }): Promise<void> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void params;
  return null as any;
}

export async function getShareableKnowledgeOverview(userId: string): Promise<KnowledgeOverview | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
  return null as any;
}

export function getDomainStatusCopy(tier: MasteryTier): string {
  return getKnowledgeTierInterpretation(tier);
}
