import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';

import {
  db,
  declaredInterests,
  feedItems,
  joshingGameResponses,
  masteryEvents,
  playerMastery,
  questions,
  users,
} from '@/server/db';
import type { MasteryTier } from '@/types/db';

export type Beat1Mastered = { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[];
export type Beat2Discovered = { domain: string; questionCount: number; correctCount: number }[];
export type Beat3Shaped = { userId: string; displayName: string; contributionCount: number }[];
export type Beat4Alignment = { userId: string; displayName: string; sharedDomains: string[] };
export type Beat5Gave = {
  totalCreatorPoints: number;
  topQuestion: { text: string; answeredCount: number } | null;
};

export type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
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

function domainFor(question: Pick<typeof questions.$inferSelect, 'canonicalSubcategory' | 'broadCategory' | 'category'>) {
  return question.canonicalSubcategory || question.broadCategory || question.category || 'General';
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

  const [gameAnswers, feedAnswers, correctQuestionIds] = await Promise.all([
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
  ]);

  const byDomain = new Map<string, { domain: string; questionCount: number; correctCount: number }>();
  const add = (domain: string, correct: boolean) => {
    if (declaredDomains.has(domain)) return;
    const current = byDomain.get(domain) ?? { domain, questionCount: 0, correctCount: 0 };
    current.questionCount += 1;
    if (correct) current.correctCount += 1;
    byDomain.set(domain, current);
  };

  gameAnswers.forEach((row) => add(domainFor(row.question), row.isCorrect === true));
  feedAnswers.forEach((row) => add(domainFor(row.question), correctQuestionIds.has(row.question.id)));

  const discovered = [...byDomain.values()].sort((a, b) => b.questionCount - a.questionCount || a.domain.localeCompare(b.domain));
  return discovered.length ? discovered : null;
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
  gameRows.forEach((row) => counts.set(row.contributorId, (counts.get(row.contributorId) ?? 0) + 1));
  feedRows.forEach((row) => {
    if (row.questionId && correctQuestionIds.has(row.questionId)) {
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

async function computeBeat4(userId: string): Promise<Beat4Alignment | null> {
  const rows = await db
    .select({
      userId: playerMastery.userId,
      displayName: users.displayName,
      domain: playerMastery.canonicalSubcategory,
    })
    .from(playerMastery)
    .innerJoin(users, eq(playerMastery.userId, users.id))
    .where(sql`${playerMastery.totalPoints} > 0`);

  const viewerDomains = new Set(rows.filter((row) => row.userId === userId).map((row) => row.domain));
  if (viewerDomains.size === 0) return null;

  const candidates = new Map<string, { displayName: string; sharedDomains: string[] }>();
  rows.forEach((row) => {
    if (row.userId === userId || !viewerDomains.has(row.domain)) return;
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

export async function computeBeats(userId: string, cycleStart: Date, cycleEnd: Date): Promise<BeatsPayload> {
  const cycleEndExclusive = endExclusive(cycleEnd);
  const [beat1, beat2, beat3, beat4, beat5] = await Promise.all([
    computeBeat1(userId, cycleStart, cycleEndExclusive),
    computeBeat2(userId, cycleStart, cycleEndExclusive),
    computeBeat3(userId, cycleStart, cycleEndExclusive),
    computeBeat4(userId),
    computeBeat5(userId, cycleStart, cycleEndExclusive),
  ]);

  return {
    cycleStart: toIsoDate(cycleStart),
    cycleEnd: toIsoDate(cycleEnd),
    beat1,
    beat2,
    beat3,
    beat4,
    beat5,
  };
}
