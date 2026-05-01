import { count, countDistinct, eq, isNull, sql } from 'drizzle-orm';

import {
  db,
  joshingGameResponses,
  joshingGames,
  playerMastery,
  questions,
  users,
} from '@/server/db';
import { getTierForPoints } from '@/server/mastery/tiers';
import type { MasteryTier } from '@/types/db';

export type UserProfile = {
  id: string;
  displayName: string;
  phoneNumber: string;
  createdAt: string;
  totalPoints: number;
  currentTier: string;
  questionsAuthored: number;
  gamesCreated: number;
  gamesPlayed: number;
};

const TIER_LABELS: Record<MasteryTier, string> = {
  establishing: 'Curious',
  familiar: 'Explorer',
  solid: 'Scholar',
  mastery: 'Sage',
};

function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  const lastFour = digits.slice(-4).padStart(4, '*');

  if (digits.length >= 11 && digits.startsWith('1')) {
    return `+1 (***) ***-${lastFour}`;
  }

  return `(***) ***-${lastFour}`;
}

function fallbackDisplayName(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  const lastFour = digits.slice(-4);
  return lastFour ? `Player ${lastFour}` : 'Player';
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  const [pointsResult, authoredResult, createdResult, playedResult] = await Promise.all([
    db
      .select({ totalPoints: sql<number>`coalesce(sum(${playerMastery.totalPoints}), 0)` })
      .from(playerMastery)
      .where(eq(playerMastery.userId, userId)),
    db
      .select({ value: count() })
      .from(questions)
      .where(sql`${questions.creatorId} = ${userId} and ${questions.deletedAt} is null`),
    db
      .select({ value: count() })
      .from(joshingGames)
      .where(eq(joshingGames.creatorId, userId)),
    db
      .select({ value: countDistinct(joshingGameResponses.gameId) })
      .from(joshingGameResponses)
      .where(eq(joshingGameResponses.userId, userId)),
  ]);

  const totalPoints = Math.round(Number(pointsResult[0]?.totalPoints ?? 0));
  const tier = getTierForPoints(totalPoints);

  return {
    id: user.id,
    displayName: user.displayName?.trim() || fallbackDisplayName(user.phoneNumber),
    phoneNumber: maskPhoneNumber(user.phoneNumber),
    createdAt: user.createdAt.toISOString(),
    totalPoints,
    currentTier: TIER_LABELS[tier],
    questionsAuthored: Number(authoredResult[0]?.value ?? 0),
    gamesCreated: Number(createdResult[0]?.value ?? 0),
    gamesPlayed: Number(playedResult[0]?.value ?? 0),
  };
}

export async function updateDisplayName(params: {
  userId: string;
  displayName: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const displayName = params.displayName.trim();

  if (displayName.length < 2 || displayName.length > 30) {
    return { ok: false, reason: 'invalid' };
  }

  await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, params.userId));

  return { ok: true };
}
