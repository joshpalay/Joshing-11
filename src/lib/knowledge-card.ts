export type KnowledgeCardTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

type TokenPayload = {
  uid: string;
  exp: number;
};

export function parseKnowledgeCardToken(token: string): TokenPayload | null {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null;
}

export async function buildKnowledgeCardPayload(userId: string): Promise<TokenPayload | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
  return null;
}

export async function getKnowledgeCardPayloadByToken(token: string): Promise<TokenPayload | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null;
}

export function buildKnowledgeCardPublicUrl(token: string): string {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  // Stub returns nothing meaningful yet; preserve the historical null runtime
  // without an `any` until the Phase 8 implementation lands.
  return null as unknown as string;
}

export function getKnowledgeTierFromPoints(points: number): KnowledgeCardTier {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void points;
  return null as unknown as KnowledgeCardTier;
}
