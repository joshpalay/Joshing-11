export type KnowledgeCardTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

type TokenPayload = {
  uid: string;
  exp: number;
};

export function parseKnowledgeCardToken(token: string): TokenPayload | null {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null as any;
}

export async function buildKnowledgeCardPayload(userId: string) {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void userId;
  return null as any;
}

export async function getKnowledgeCardPayloadByToken(token: string) {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null as any;
}

export function buildKnowledgeCardPublicUrl(token: string): string {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null as any;
}

export function getKnowledgeTierFromPoints(points: number): KnowledgeCardTier {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void points;
  return null as any;
}
