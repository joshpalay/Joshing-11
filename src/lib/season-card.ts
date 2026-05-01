import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';

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
  groupId: string;
  gameId: string;
  scope: SeasonCardScope;
  roundId?: string;
};

type TokenPayload = {
  gid: string;
  gameId: string;
  uid: string;
  scope: SeasonCardScope;
  roundId?: string;
  exp: number;
};

const iconKeyMap: Record<string, string> = {
  classical_music: 'classical_music',
  literature: 'literature_novel',
  history: 'history_general',
  philosophy: 'philosophy',
  science: 'science',
  film_tv: 'film_tv',
  sport: 'sport',
  language: 'language',
  pop_culture: 'pop_culture',
};

const subcategoryOverrides: Record<string, string> = {
  'ts-eliot-poetry': 'literature_poetry',
  'james-joyces-ulysses': 'literature_novel',
  'mozart-operas': 'opera',
  'second-viennese-school': 'classical_music',
  'alexander-the-greats-campaigns': 'history_campaigns',
};

export function getIconKey(slug: string, broadCategory: string | null | undefined): string {
  return subcategoryOverrides[slug] ?? (broadCategory ? iconKeyMap[broadCategory] : undefined) ?? 'default';
}

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function isValidRoundDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

function formatDateRange(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${startStr} – ${endStr}`;
}

function getTierLabel(tier: SeasonCardTier): string {
  if (tier === 'mastery') return 'Mastery';
  if (tier === 'solid') return 'Solid';
  if (tier === 'familiar') return 'Familiar';
  return 'Establishing';
}

function buildShareText(periodLabel: string, groupName: string, domains: SeasonCardDomain[], storyLine: string): string {
  const domainLines = domains.map((d) => `${d.canonical_subcategory}  ${getTierLabel(d.current_tier)}`).join('\n');
  return `${periodLabel} · ${groupName}\n\n${domainLines}\n\n"${storyLine}"\n\njoshing.com`;
}

function storyLineFor(params: {
  domains: SeasonCardDomain[];
  scope: SeasonCardScope;
  gameNumber: number;
  roundNumber: number;
}): string {
  const { domains, scope, gameNumber, roundNumber } = params;
  if (domains.length === 0) return 'A new world is opening up.';

  const top = domains[0];
  const second = domains[1];
  const allEstablishing = domains.every((d) => d.current_tier === 'establishing');
  const masteryDomain = domains.find((d) => d.current_tier === 'mastery');

  if (masteryDomain) return `You've made ${masteryDomain.canonical_subcategory} yours.`;
  if (top.current_tier === 'solid') return `${top.canonical_subcategory} is where you go deepest.`;
  if (top.current_tier === 'familiar') return `${top.canonical_subcategory} is coming into focus.`;
  if (allEstablishing && domains.length >= 4) {
    return `Your world is wide this season — ${domains.length} territories and counting.`;
  }
  if (allEstablishing && scope === 'round' && gameNumber === 1 && roundNumber === 1) {
    return 'A new world is opening up.';
  }
  if (top && second && top.current_tier !== second.current_tier) {
    return `Deep roots in ${top.canonical_subcategory}, and new ground in ${second.canonical_subcategory}.`;
  }
  return `${top.canonical_subcategory} is where you're building.`;
}

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || 'dev-season-card-secret';
}

function signPayload(payload: TokenPayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function parseSeasonCardToken(token: string): TokenPayload | null {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function buildSeasonCardPayload(params: BuildParams): Promise<SeasonCardPayload | null> {
  void params;
  // TODO v11.0: prisma.group.findUnique - needs new data source
  // TODO v11.0: prisma.game.findUnique - needs new data source
  // TODO v11.0: question.game_questions relation - needs new data source
  // TODO v11.0: answer.game_id season scoping - needs new data source
  return null;
}

export function buildSeasonCardPublicUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  return `${baseUrl}/share/season-card/${token}`;
}
