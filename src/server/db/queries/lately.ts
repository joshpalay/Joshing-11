import { and, desc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';

import {
  collectMilestoneQuestionIds,
  deriveLatelyMilestones,
  type LatelyMilestone,
  type MilestoneAnswerRow,
} from '@/lib/lately-milestones';
import { resolveAuthorDisplay } from '@/lib/questions-types';
import { db, feedItems, follows, masteryEvents, questions, users } from '@/server/db';
import { SOCIAL_FEED_SOURCE_TYPE } from '@/server/feed/visibility';

export type LatelyDirection = 'they_got_you' | 'you_got_them';

export type LatelyMoment = {
  momentId: string;
  dir: LatelyDirection;
  friendId: string;
  friendName: string;
  friendFirstName: string;
  questionId: string;
  questionText: string;
  category: string;
  gameTitle: string;
  answeredAt: Date;
};

const CATEGORY_ENUM_PRETTY: Record<string, string> = {
  music: 'music',
  literature: 'literature',
  history: 'history',
  film_tv: 'film & TV',
  sport: 'sport',
  science: 'science',
  philosophy: 'philosophy',
  pop_culture: 'pop culture',
  language: 'language',
  general_knowledge: 'general knowledge',
};

function prettifyCategory(canonical: string | null, coarse: string | null): string {
  const trimmed = canonical?.trim();
  if (trimmed) return trimmed;
  if (coarse && CATEGORY_ENUM_PRETTY[coarse]) return CATEGORY_ENUM_PRETTY[coarse];
  return 'something';
}

function firstName(displayName: string | null, fallback: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) return fallback;
  const head = trimmed.split(/\s+/)[0];
  return head || fallback;
}

// Lately surfaces "friend correctly answered your question" (they_got_you) and
// "you correctly answered friend's question" (you_got_them). Every answer in
// the app — daily, feed, catchup, joshing game, direct question — writes a
// masteryEvents row; the legacy JoshingGameResponses table only sees the
// joshing-game subset, so querying from there missed ~all events.
//
// sourceType IN ('live_correct', 'catchup_correct') gates by SURFACE (live
// vs catchup), not correctness — the naming is misleading. Correctness lives
// in answerState; 'incorrect' must be excluded so wrong answers don't render
// as "Robyn got you on …".
//
// masteryEvents.userId IS the answerer for these surface rows (only
// author_credit / curator_credit put a non-answerer there, and those source
// types are excluded by the sourceType filter).
const CORRECT_ANSWER_STATES = [
  'first_correct',
  'first_correct_after_wrong',
  'repeat_correct',
] as const;
const LIVE_SOURCE_TYPES = ['live_correct', 'catchup_correct'] as const;

export async function getLatelyMoments(userId: string): Promise<LatelyMoment[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const friendIdExpr = sql<string>`CASE WHEN ${questions.creatorId} = ${userId} THEN ${masteryEvents.userId} ELSE ${questions.creatorId} END`;

  const rows = await db
    .select({
      momentId: masteryEvents.id,
      creatorId: questions.creatorId,
      answererId: masteryEvents.userId,
      friendId: friendIdExpr,
      friendDisplayName: users.displayName,
      questionId: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      answeredAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .innerJoin(users, eq(users.id, friendIdExpr))
    .where(
      and(
        inArray(masteryEvents.sourceType, LIVE_SOURCE_TYPES),
        inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, thirtyDaysAgo),
        or(
          and(eq(questions.creatorId, userId), ne(masteryEvents.userId, userId)),
          and(eq(masteryEvents.userId, userId), ne(questions.creatorId, userId)),
        ),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt))
    .limit(200);

  const moments: LatelyMoment[] = [];
  for (const row of rows) {
    if (!row.answeredAt) continue;
    if (!row.friendId) continue;
    const dir: LatelyDirection =
      row.creatorId === userId ? 'they_got_you' : 'you_got_them';
    const friendName = row.friendDisplayName?.trim() || 'A friend';
    moments.push({
      momentId: row.momentId,
      dir,
      friendId: row.friendId,
      friendName,
      friendFirstName: firstName(row.friendDisplayName, friendName),
      questionId: row.questionId,
      questionText: row.questionText,
      category: prettifyCategory(row.canonicalSubcategory, row.category),
      // Footnote brand label. v2 spec example uses ASTERISK; not worth
      // per-surface disambiguation until the user asks for it.
      gameTitle: 'asterisk',
      answeredAt: row.answeredAt,
    });
  }
  return moments;
}

const MILESTONE_WINDOW_DAYS = 30;

// Resolve the canonical domain a milestone groups by. Mirrors the spec's
// "joined to the canonical question for canonicalSubcategory", falling back the
// same way the feed write path does (broadCategory, then the coarse category
// enum) so groups line up with how the `friend_answered` rows were created.
// Returns null when there's no real domain — those rows can't anchor a card.
function resolveMilestoneDomain(
  canonical: string | null,
  broad: string | null,
  category: string | null,
): string | null {
  const c = canonical?.trim();
  if (c) return c;
  const b = broad?.trim();
  if (b) return b;
  if (category && CATEGORY_ENUM_PRETTY[category]) return CATEGORY_ENUM_PRETTY[category];
  return null;
}

/**
 * Lately skill milestones (D-4 §A). Read-time aggregate of `friend_answered`
 * correct items where I'm the recipient and the answerer is someone I follow,
 * within the 30-day Lately horizon, joined to the canonical question. The deep
 * vs. breadth split (A-1) lives in the pure `deriveLatelyMilestones`.
 */
export async function getLatelyMilestones(userId: string): Promise<LatelyMilestone[]> {
  const windowStart = new Date(Date.now() - MILESTONE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      friendId: feedItems.sourceUserId,
      friendDisplayName: users.displayName,
      questionId: feedItems.questionId,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      answeredAt: feedItems.sourceEventAt,
    })
    .from(feedItems)
    // sourceUserId ∈ {people I follow}: inner-join the approved follow edge so a
    // friend_answered row from someone I don't follow is dropped at the DB.
    .innerJoin(
      follows,
      and(
        eq(follows.followeeId, feedItems.sourceUserId),
        eq(follows.followerId, userId),
        eq(follows.state, 'approved'),
      ),
    )
    .innerJoin(questions, eq(questions.id, feedItems.questionId))
    .innerJoin(users, eq(users.id, feedItems.sourceUserId))
    .where(
      and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
        eq(feedItems.sourceResult, 'correct'),
        isNotNull(feedItems.questionId),
        gte(feedItems.sourceEventAt, windowStart),
      ),
    )
    .orderBy(desc(feedItems.sourceEventAt))
    .limit(500);

  const answerRows: MilestoneAnswerRow[] = [];
  for (const row of rows) {
    if (!row.questionId || !row.answeredAt) continue;
    const domain = resolveMilestoneDomain(
      row.canonicalSubcategory,
      row.broadCategory,
      row.category,
    );
    if (!domain) continue;
    const friendName = row.friendDisplayName?.trim() || 'A friend';
    answerRows.push({
      friendId: row.friendId,
      friendName,
      friendFirstName: firstName(row.friendDisplayName, friendName),
      domain,
      questionId: row.questionId,
      answeredAt: row.answeredAt,
    });
  }

  return deriveLatelyMilestones(answerRows);
}

// A friend's literal question, shaped for the seeded play session (the Lately
// milestone click-through). Practice-only — carries everything needed to render
// and grade, nothing about scoring.
export type SeededPlayQuestion = {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  acceptedAlternatives: string[];
  questionType: string;
  domain: string | null;
  explanation: string | null;
  authorName: string | null;
  authorIsHouse: boolean;
};

/**
 * Resolve the literal questions behind a milestone click-through, in the order
 * requested. Authorization is by construction: a question only resolves if it
 * appears in THIS viewer's own milestones, so the seeded list can't be used to
 * play arbitrary questions. Shared by the play page and its grade route.
 */
export async function getSeededPlayQuestions(
  userId: string,
  requestedIds: string[],
): Promise<SeededPlayQuestion[]> {
  if (requestedIds.length === 0) return [];

  const allowed = collectMilestoneQuestionIds(await getLatelyMilestones(userId));
  const authorizedIds = requestedIds.filter((id) => allowed.has(id));
  if (authorizedIds.length === 0) return [];

  const rows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      acceptedAlternatives: questions.acceptedAlternatives,
      questionType: questions.questionType,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      factualExplanation: questions.factualExplanation,
      explainerFull: questions.explainerFull,
      explainerBrief: questions.explainerBrief,
      creatorId: questions.creatorId,
      source: questions.source,
      deletedAt: questions.deletedAt,
      authorDisplayName: users.displayName,
    })
    .from(questions)
    .leftJoin(users, eq(users.id, questions.creatorId))
    .where(inArray(questions.id, authorizedIds));

  const byId = new Map(rows.map((row) => [row.id, row]));

  const resolved: SeededPlayQuestion[] = [];
  for (const id of authorizedIds) {
    const row = byId.get(id);
    if (!row || row.deletedAt) continue;
    const author = resolveAuthorDisplay(row.creatorId, row.source, row.authorDisplayName);
    resolved.push({
      questionId: row.id,
      questionText: row.questionText,
      correctAnswer: row.answerText,
      acceptedAlternatives: row.acceptedAlternatives ?? [],
      questionType: row.questionType,
      domain: resolveMilestoneDomain(row.canonicalSubcategory, row.broadCategory, row.category),
      explanation: row.factualExplanation ?? row.explainerFull ?? row.explainerBrief ?? null,
      authorName: author.authorName,
      authorIsHouse: author.authorIsHouse,
    });
  }
  return resolved;
}
