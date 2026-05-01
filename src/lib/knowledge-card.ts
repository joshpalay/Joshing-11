import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getIconKey } from '@/lib/season-card';
import { toSlug } from '@/server/profile/to-slug';
import { getMasteryTierDisplay } from '@/server/mastery/get-mastery-tier-display';

export type KnowledgeCardTier = 'establishing' | 'familiar' | 'solid' | 'mastery';

type TokenPayload = {
  uid: string;
  exp: number;
};

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || 'dev-knowledge-card-secret';
}

function signPayload(payload: TokenPayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function parseKnowledgeCardToken(token: string): TokenPayload | null {
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

function getTierLabel(tier: KnowledgeCardTier): string {
  if (tier === 'mastery') return 'Mastery';
  if (tier === 'solid') return 'Solid';
  if (tier === 'familiar') return 'Familiar';
  return 'Establishing';
}

function getTierSignature(domains: Array<{ canonical_subcategory: string; current_tier: KnowledgeCardTier; lifetime_points: number }>): string {
  if (domains.length === 0) return 'A portrait just beginning to take shape';
  const sorted = [...domains].sort((a, b) => b.lifetime_points - a.lifetime_points);
  const mastery = sorted.filter((d) => d.current_tier === 'mastery');
  if (mastery.length > 0) return `Mastery · ${mastery[0].canonical_subcategory}`;
  const top = sorted[0];
  if (top.current_tier === 'solid') return `Solid ground in ${top.canonical_subcategory}`;
  if (top.current_tier === 'familiar') return `Building across ${sorted.length} territories`;
  if (sorted.length >= 4) return 'New territory everywhere — this is just the beginning';
  return 'A portrait just beginning to take shape';
}

function buildShareText(playerDisplayName: string, portraitStatement: string, domains: Array<{ canonical_subcategory: string; current_tier: KnowledgeCardTier }>, rarest: string | null): string {
  const lines = domains.slice(0, 3).map((d) => `${d.canonical_subcategory}  ${getTierLabel(d.current_tier)}`).join('\n');
  const rarestLine = rarest ? `\n\nRarest territory: ${rarest}` : '';
  return `${playerDisplayName}'s Knowledge Portrait · Joshing\n\n${lines}\n\n"${portraitStatement}"${rarestLine}\n\njoshing.com`;
}


async function readKnowledgeRows(userId: string) {
  const [user, topRows, rarest] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        display_name: true,
        knowledge_card_share_token: true,
        knowledge_card_share_expires_at: true,
      },
    }),
    prisma.$queryRaw<Array<{ canonical_subcategory: string; broad_category: string | null; current_tier: KnowledgeCardTier; lifetime_points: number }>>`
      SELECT canonical_subcategory, broad_category, tier::text as current_tier, total_points as lifetime_points
      FROM "PLAYER_MASTERY"
      WHERE user_id = ${userId}
      AND total_points > 0
      ORDER BY total_points DESC, canonical_subcategory ASC
    `,
    prisma.$queryRaw<Array<{ canonical_subcategory: string; other_players_with_territory: bigint }>>`
      SELECT
        pm_self.canonical_subcategory,
        COUNT(DISTINCT pm_others.user_id) as other_players_with_territory
      FROM "PLAYER_MASTERY" pm_self
      LEFT JOIN "PLAYER_MASTERY" pm_others
        ON pm_others.canonical_subcategory = pm_self.canonical_subcategory
        AND pm_others.user_id != ${userId}
        AND pm_others.total_points > 0
      WHERE pm_self.user_id = ${userId}
        AND pm_self.total_points > 0
      GROUP BY pm_self.canonical_subcategory
      ORDER BY other_players_with_territory ASC
      LIMIT 1
    `,
  ]);
  return { user, topRows, rarest };
}

function makePayload(params: { userDisplayName: string; topRows: Array<{ canonical_subcategory: string; broad_category: string | null; current_tier: KnowledgeCardTier; lifetime_points: number }>; rarest: Array<{ canonical_subcategory: string; other_players_with_territory: bigint }>; shareCardToken: string; shareCardExpiresAt: Date; }) {
  const { userDisplayName, topRows, rarest, shareCardToken, shareCardExpiresAt } = params;

  const visibleDomains = topRows.slice(0, 6).map((row) => ({
    canonical_subcategory: row.canonical_subcategory,
    canonical_subcategory_slug: toSlug(row.canonical_subcategory),
    current_tier: row.current_tier,
    lifetime_points: Number(row.lifetime_points),
    icon_key: getIconKey(toSlug(row.canonical_subcategory), row.broad_category),
  }));

  const portraitTop = topRows.slice(0, 3).map((row) => row.canonical_subcategory);
  const portraitStatement = portraitTop.length > 0
    ? `A mind taking shape through ${portraitTop.join(', ')}.`
    : 'A mind still taking shape through each new question.';

  const rarestRow = rarest[0];
  const rarestTerritory = rarestRow?.canonical_subcategory ?? null;
  const rarestCount = rarestRow ? Number(rarestRow.other_players_with_territory) : 0;

  return {
    player_display_name: userDisplayName,
    portrait_statement: portraitStatement,
    domains: visibleDomains,
    overflow_count: Math.max(0, topRows.length - 6),
    tier_signature: getTierSignature(topRows),
    rarest_territory: rarestTerritory,
    rarest_territory_solo: rarestTerritory ? rarestCount === 0 : false,
    share_text: buildShareText(userDisplayName, portraitStatement, topRows, rarestTerritory),
    share_card_token: shareCardToken,
    share_card_expires_at: shareCardExpiresAt.toISOString(),
  };
}
export async function buildKnowledgeCardPayload(userId: string) {
  const { user, topRows, rarest } = await readKnowledgeRows(userId);
  if (!user) return null;

  const existingShareToken = user.knowledge_card_share_token?.trim() || null;
  const existingShareExpiry = user.knowledge_card_share_expires_at;
  const hasValidExistingShareToken =
    !!existingShareToken && !!existingShareExpiry && existingShareExpiry.getTime() > Date.now();

  const shareCardExpiresAt = hasValidExistingShareToken
    ? existingShareExpiry
    : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const shareCardToken = hasValidExistingShareToken
    ? existingShareToken
    : signPayload({ uid: userId, exp: shareCardExpiresAt.getTime() });

  if (!hasValidExistingShareToken) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        knowledge_card_share_token: shareCardToken,
        knowledge_card_share_expires_at: shareCardExpiresAt,
      },
    });
  }

  return makePayload({
    userDisplayName: user.display_name?.trim() || 'Player',
    topRows,
    rarest,
    shareCardToken,
    shareCardExpiresAt,
  });
}

export async function getKnowledgeCardPayloadByToken(token: string) {
  const user = await prisma.user.findFirst({
    where: { knowledge_card_share_token: token },
    select: { id: true, display_name: true, knowledge_card_share_expires_at: true },
  });
  if (!user || !user.knowledge_card_share_expires_at) return null;
  if (user.knowledge_card_share_expires_at.getTime() < Date.now()) return null;

  const { topRows, rarest } = await readKnowledgeRows(user.id);
  return makePayload({
    userDisplayName: user.display_name?.trim() || 'Player',
    topRows,
    rarest,
    shareCardToken: token,
    shareCardExpiresAt: user.knowledge_card_share_expires_at,
  });
}

export function buildKnowledgeCardPublicUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  return `${baseUrl}/share/knowledge-card/${token}`;
}

export function getKnowledgeTierFromPoints(points: number): KnowledgeCardTier {
  return getMasteryTierDisplay(points).tier;
}
