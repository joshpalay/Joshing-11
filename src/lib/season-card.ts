export type SeasonCardScope = 'round' | 'game';
export type SeasonCardTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

export type SeasonCardDomain = {
  canonical_subcategory: string;
  canonical_subcategory_slug: string;
  current_tier: SeasonCardTier;
  points_this_period: number;
  icon_key: string;
};

export type SeasonCardPayload = {
  scope: SeasonCardScope;
  period_label: string;
  group_name: string;
  date_range: string;
  player_display_name: string;
  domains: SeasonCardDomain[];
  overflow_count: number;
  story_line: string;
  share_text: string;
  share_card_token: string;
  share_card_expires_at: string;
};

type BuildParams = {
  userId: string;
  groupId?: unknown;
  gameId?: unknown;
  scope: SeasonCardScope;
  roundId?: string;
};

type TokenPayload = {
  gid?: unknown;
  gameId?: unknown;
  uid: string;
  scope: SeasonCardScope;
  roundId?: string;
  exp: number;
};

export function getIconKey(slug: string, broadCategory: string | null | undefined): string {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void slug;
  void broadCategory;
  return null as any;
}

export function parseSeasonCardToken(token: string): TokenPayload | null {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null as any;
}

export async function buildSeasonCardPayload(params: BuildParams): Promise<SeasonCardPayload | null> {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void params;
  return null as any;
}

export function buildSeasonCardPublicUrl(token: string): string {
  // TODO Phase 8: port to Drizzle when friend profiles are built
  void token;
  return null as any;
}
