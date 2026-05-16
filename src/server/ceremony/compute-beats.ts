import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  declaredInterests,
  feedItems,
  joshingGameResponses,
  masteryEvents,
  playerMastery,
  profileDomainVisibility,
  questions,
  users,
} from '@/server/db';
import { getFriends } from '@/server/db/queries/friends';
import { ceremonyModeFromAnsweringCount, type CeremonyMode } from '@/lib/ceremony/mode';
import type { MasteryTier } from '@/types/db';

// F3.5: runtime validation of the beats payload. Strict at write time
// (catches bugs in compute-beats early); lenient at read time (don't break
// the pre-existing corpus that may not match this schema exactly — see the
// ceremony GET route).
const masteryTierSchema = z.enum(['establishing', 'familiar', 'solid', 'mastery']);

const beat1Schema = z.array(
  z.object({
    domain: z.string(),
    fromTier: masteryTierSchema,
    toTier: masteryTierSchema,
  }),
);

const beat2Schema = z.object({
  friendMediated: z.array(
    z.object({
      domain: z.string(),
      questionCount: z.number(),
      correctCount: z.number(),
    }),
  ),
  authored: z.array(z.object({ domain: z.string() })),
  promoted: z.array(z.object({ domain: z.string() })),
});

const beat3Schema = z.array(
  z.object({
    userId: z.string(),
    displayName: z.string(),
    contributionCount: z.number(),
  }),
);

const beat4Schema = z.object({
  userId: z.string(),
  displayName: z.string(),
  sharedDomains: z.array(z.string()),
});

const beat5Schema = z.object({
  totalCreatorPoints: z.number(),
  topQuestion: z
    .object({ text: z.string(), answeredCount: z.number() })
    .nullable(),
});

export const beatsPayloadSchema = z.object({
  cycleStart: z.string(),
  cycleEnd: z.string(),
  mode: z.enum(['solo', 'duo', 'group']).optional(),
  mergeNote: z
    .object({
      mergesApplied: z.number(),
      details: z.array(
        z.object({
          sources: z.array(z.string()),
          target: z.string(),
          rationale: z.string(),
        }),
      ),
    })
    .optional(),
  beat1: beat1Schema.nullable(),
  beat2: beat2Schema.nullable(),
  beat3: beat3Schema.nullable(),
  beat4: beat4Schema.nullable(),
  beat5: beat5Schema.nullable(),
});

export type Beat1Mastered = { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[];
export type Beat2DiscoveredItem = { domain: string; questionCount: number; correctCount: number };
export type Beat2Discovered = {
  friendMediated: Beat2DiscoveredItem[];
  authored: { domain: string }[];
  promoted: { domain: string }[];
};
export type Beat3Shaped = { userId: string; displayName: string; contributionCount: number }[];
export type Beat4Alignment = { userId: string; displayName: string; sharedDomains: string[] };
export type Beat5Gave = {
  totalCreatorPoints: number;
  topQuestion: { text: string; answeredCount: number } | null;
};

export type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  /**
   * F3.2: classifies the ceremony as solo / duo / group based on the count
   * of friends who actively answered in the cycle. Drives copy variants and
   * future beat suppression (e.g. Beat 3 / Beat 4 don't make sense in solo
   * mode). Stored on the payload (not as a separate column) to avoid a
   * schema migration; downstream UI / telemetry can read it directly.
   */
  mode?: CeremonyMode;
  mergeNote?: {
    mergesApplied: number;
    details: Array<{ sources: string[]; target: string; rationale: string }>;
  };
  beat1: Beat1Mastered | null;
  beat2: Beat2Discovered | null;
  beat3: Beat3Shaped | null;
  beat4: Beat4Alignment | null;
  beat5: Beat5Gave | null;
};

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endExclusive(cycleEnd: Date): Date {
  const end = new Date(cycleEnd);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(0, 0, 0, 0);
  return end;
}

function domainFor(question: Pick<typeof questions.$inferSelect, 'canonicalSubcategory' | 'broadCategory' | 'category'>): string | null {
  return question.canonicalSubcategory || question.broadCategory || question.category || null;
}

function previousTier(tier: MasteryTier): MasteryTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, index - 1)] ?? 'establishing';
}

async function computeBeat1(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat1Mastered | null> {
  const rows = await db
    .select({
      domain: playerMastery.canonicalSubcategory,
      toTier: playerMastery.tier,
    })
    .from(playerMastery)
    .where(and(
      eq(playerMastery.userId, userId),
      isNotNull(playerMastery.tierReachedAt),
      gte(playerMastery.tierReachedAt, cycleStart),
      lt(playerMastery.tierReachedAt, cycleEndExclusive),
    ))
    .orderBy(desc(playerMastery.tierReachedAt));

  if (rows.length === 0) return null;
  return rows.map((row) => ({
    domain: row.domain,
    fromTier: previousTier(row.toTier),
    toTier: row.toTier,
  }));
}

async function readCorrectQuestionIds(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Set<string>> {
  const rows = await db
    .select({ questionId: masteryEvents.questionId })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.answeredByUserId, userId),
      eq(masteryEvents.sourceType, 'live_correct'),
      isNotNull(masteryEvents.questionId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
      sql`${masteryEvents.awardedPoints} > 0`,
    ));

  return new Set(rows.map((row) => row.questionId).filter((id): id is string => Boolean(id)));
}

async function computeBeat2(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat2Discovered | null> {
  const interests = await db
    .select({ domain: declaredInterests.domain })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));
  const declaredDomains = new Set(interests.map((interest) => interest.domain));

  const [gameAnswers, feedAnswers, correctQuestionIds, authoredDeclared, promotedRows] = await Promise.all([
    db
      .select({ question: questions, isCorrect: joshingGameResponses.isCorrect })
      .from(joshingGameResponses)
      .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
      .where(and(
        eq(joshingGameResponses.userId, userId),
        gte(joshingGameResponses.answeredAt, cycleStart),
        lt(joshingGameResponses.answeredAt, cycleEndExclusive),
      )),
    db
      .select({ question: questions })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.state, 'answered'),
        gte(feedItems.sourceEventAt, cycleStart),
        lt(feedItems.sourceEventAt, cycleEndExclusive),
      )),
    readCorrectQuestionIds(userId, cycleStart, cycleEndExclusive),
    db
      .select({ domain: playerMastery.canonicalSubcategory })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        eq(playerMastery.territoryType, 'declared'),
        gte(playerMastery.updatedAt, cycleStart),
        lt(playerMastery.updatedAt, cycleEndExclusive),
      )),
    db
      .select({ domain: masteryEvents.canonicalSubcategory })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.sourceType, 'declared_promoted'),
        gte(masteryEvents.createdAt, cycleStart),
        lt(masteryEvents.createdAt, cycleEndExclusive),
      )),
  ]);

  const byDomain = new Map<string, { domain: string; questionCount: number; correctCount: number }>();
  const add = (domain: string, correct: boolean) => {
    if (declaredDomains.has(domain)) return;
    const current = byDomain.get(domain) ?? { domain, questionCount: 0, correctCount: 0 };
    current.questionCount += 1;
    if (correct) current.correctCount += 1;
    byDomain.set(domain, current);
  };

  gameAnswers.forEach((row) => {
    const domain = domainFor(row.question);
    if (domain) add(domain, row.isCorrect === true);
  });
  feedAnswers.forEach((row) => {
    const domain = domainFor(row.question);
    if (domain) add(domain, correctQuestionIds.has(row.question.id));
  });

  const friendMediated = [...byDomain.values()].sort((a, b) => b.questionCount - a.questionCount || a.domain.localeCompare(b.domain));

  const seenAuthored = new Set<string>();
  const authored = authoredDeclared
    .map((row) => ({ domain: row.domain }))
    .filter((row) => { if (seenAuthored.has(row.domain)) return false; seenAuthored.add(row.domain); return true; });

  const seenPromoted = new Set<string>();
  const promoted = promotedRows
    .map((row) => ({ domain: row.domain }))
    .filter((row) => { if (seenPromoted.has(row.domain)) return false; seenPromoted.add(row.domain); return true; });

  if (friendMediated.length === 0 && authored.length === 0 && promoted.length === 0) return null;
  return { friendMediated, authored, promoted };
}

async function computeBeat3(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat3Shaped | null> {
  const [gameRows, feedRows, correctQuestionIds] = await Promise.all([
    db
      .select({ contributorId: questions.creatorId, questionId: questions.id })
      .from(joshingGameResponses)
      .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
      .where(and(
        eq(joshingGameResponses.userId, userId),
        eq(joshingGameResponses.isCorrect, true),
        gte(joshingGameResponses.answeredAt, cycleStart),
        lt(joshingGameResponses.answeredAt, cycleEndExclusive),
        ne(questions.creatorId, userId),
      )),
    db
      .select({ contributorId: feedItems.sourceUserId, questionId: feedItems.questionId })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.state, 'answered'),
        ne(feedItems.sourceUserId, userId),
        gte(feedItems.sourceEventAt, cycleStart),
        lt(feedItems.sourceEventAt, cycleEndExclusive),
      )),
    readCorrectQuestionIds(userId, cycleStart, cycleEndExclusive),
  ]);

  const counts = new Map<string, number>();
  gameRows.forEach((row) => {
    if (row.contributorId) counts.set(row.contributorId, (counts.get(row.contributorId) ?? 0) + 1);
  });
  feedRows.forEach((row) => {
    if (row.contributorId && row.questionId && correctQuestionIds.has(row.questionId)) {
      counts.set(row.contributorId, (counts.get(row.contributorId) ?? 0) + 1);
    }
  });

  const topIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
  if (topIds.length === 0) return null;

  const userRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, topIds));
  const nameById = new Map(userRows.map((user) => [user.id, user.displayName?.trim() || 'Someone']));

  return topIds.map((id) => ({
    userId: id,
    displayName: nameById.get(id) ?? 'Someone',
    contributionCount: counts.get(id) ?? 0,
  }));
}

async function computeBeat4(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat4Alignment | null> {
  const friends = await getFriends(userId);
  const friendIds = new Set(friends.map((friend) => friend.id));
  if (friendIds.size === 0) return null;

  // Only consider friends who answered at least one question in this cycle;
  // all-time mastery overlap could surface a friend who hasn't played in months.
  const activeFriendRows = await db
    .selectDistinct({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      inArray(masteryEvents.userId, [...friendIds]),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));
  const activeFriendIds = new Set(activeFriendRows.map((r) => r.userId));
  if (activeFriendIds.size === 0) return null;

  // F3.4: LEFT JOIN profileDomainVisibility so we can filter friend rows
  // marked private. Viewer's own rows always pass through (their portrait,
  // their data); only the FRIEND's privacy setting hides a friend's domain
  // from this viewer's alignment beat. Missing visibility row defaults to
  // 'public' (per the table default), which is included.
  const rows = await db
    .select({
      userId: playerMastery.userId,
      displayName: users.displayName,
      domain: playerMastery.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
    })
    .from(playerMastery)
    .innerJoin(users, eq(playerMastery.userId, users.id))
    .leftJoin(
      profileDomainVisibility,
      and(
        eq(profileDomainVisibility.userId, playerMastery.userId),
        eq(profileDomainVisibility.canonicalSubcategory, playerMastery.canonicalSubcategory),
      ),
    )
    .where(sql`${playerMastery.totalPoints} > 0`);

  const viewerDomains = new Set(rows.filter((row) => row.userId === userId).map((row) => row.domain));
  if (viewerDomains.size === 0) return null;

  const candidates = new Map<string, { displayName: string; sharedDomains: string[] }>();
  rows.forEach((row) => {
    if (row.userId === userId || !activeFriendIds.has(row.userId) || !viewerDomains.has(row.domain)) return;
    // A friend marked this domain private — do not surface it to anyone
    // else's ceremony, even if both share points there.
    if (row.visibility === 'private') return;
    const current = candidates.get(row.userId) ?? { displayName: row.displayName?.trim() || 'Someone', sharedDomains: [] };
    current.sharedDomains.push(row.domain);
    candidates.set(row.userId, current);
  });

  const [best] = [...candidates.entries()].sort((a, b) => b[1].sharedDomains.length - a[1].sharedDomains.length);
  if (!best || best[1].sharedDomains.length === 0) return null;
  return { userId: best[0], displayName: best[1].displayName, sharedDomains: best[1].sharedDomains.sort() };
}

async function computeBeat5(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat5Gave | null> {
  const rows = await db
    .select({
      questionId: masteryEvents.questionId,
      awardedPoints: masteryEvents.awardedPoints,
      questionText: questions.questionText,
    })
    .from(masteryEvents)
    .leftJoin(questions, eq(masteryEvents.questionId, questions.id))
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.sourceType, 'author_credit'),
      ne(masteryEvents.answeredByUserId, userId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  if (rows.length === 0) return null;
  const totalCreatorPoints = Math.round(rows.reduce((sum, row) => sum + Number(row.awardedPoints ?? 0), 0) * 10) / 10;
  const byQuestion = new Map<string, { text: string; answeredCount: number }>();
  rows.forEach((row) => {
    if (!row.questionId || !row.questionText) return;
    const current = byQuestion.get(row.questionId) ?? { text: row.questionText, answeredCount: 0 };
    current.answeredCount += 1;
    byQuestion.set(row.questionId, current);
  });
  const [topQuestion] = [...byQuestion.values()].sort((a, b) => b.answeredCount - a.answeredCount);
  return { totalCreatorPoints, topQuestion: topQuestion ?? null };
}

/**
 * F3.2 — count friends who answered at least one question in the cycle.
 * Plus the user themselves (always 1). Used to derive ceremony mode.
 */
async function countActiveAnsweringPlayers(
  userId: string,
  cycleStart: Date,
  cycleEndExclusive: Date,
): Promise<number> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return 1;

  const friendIds = friends.map((friend) => friend.id);
  const rows = await db
    .selectDistinct({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      inArray(masteryEvents.userId, friendIds),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  return rows.length + 1;
}

export async function computeBeats(userId: string, cycleStart: Date, cycleEnd: Date): Promise<BeatsPayload> {
  const cycleEndExclusive = endExclusive(cycleEnd);
  const [beat1, beat2, beat3, beat4, beat5, activeAnsweringPlayers] = await Promise.all([
    computeBeat1(userId, cycleStart, cycleEndExclusive),
    computeBeat2(userId, cycleStart, cycleEndExclusive),
    computeBeat3(userId, cycleStart, cycleEndExclusive),
    computeBeat4(userId, cycleStart, cycleEndExclusive),
    computeBeat5(userId, cycleStart, cycleEndExclusive),
    countActiveAnsweringPlayers(userId, cycleStart, cycleEndExclusive),
  ]);

  const mode = ceremonyModeFromAnsweringCount(activeAnsweringPlayers);
  // Beat 3 (Shaped) and Beat 4 (Alignment) require at least one active friend;
  // suppress both in solo mode so the ceremony doesn't reference absent friends.
  const beat3Final = mode === 'solo' ? null : beat3;
  const beat4Final = mode === 'solo' ? null : beat4;

  return {
    cycleStart: toIsoDate(cycleStart),
    cycleEnd: toIsoDate(cycleEnd),
    mode,
    beat1,
    beat2,
    beat3: beat3Final,
    beat4: beat4Final,
    beat5,
  };
}
