import { getKnowledgeTierInterpretation } from '@/server/profile/knowledge-tier-copy';
import type { DomainDetail, KnowledgeOverview } from '@/server/profile/knowledge-types';
import type { MasteryTier } from '@/types/db';

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
