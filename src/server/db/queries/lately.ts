import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import {
  deriveLatelyMilestones,
  type LatelyMilestone,
  type MilestoneAnswerRow,
} from '@/lib/lately-milestones';
import {
  collectFriendActivityQuestionIds,
  deriveFriendActivity,
  type FriendActivityCard,
  type FriendPlayRow,
  type PlayContext,
} from '@/lib/friend-activity';
import {
  deriveConvergences,
  type Convergence,
  type ConvergenceCoCorrectRow,
} from '@/lib/convergence';
import { resolveAuthorDisplay } from '@/lib/questions-types';
import {
  FRIEND_FACING_TIERS,
  applyTierGate,
  type TrustTier,
} from '@/server/daily/verification-gating';
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
        // Never surface the viewer's OWN authored questions here. The milestone
        // expansion offers each question to ANSWER (full credit via
        // /api/lately/milestone/answer), but you can't answer your own question —
        // that route 403s on it, leaving a dead "ANSWER →" button. A friend
        // answering your question is already surfaced as a `they_got_you` moment
        // ("Robyn got your question" -> send it onward), so excluding it here
        // removes the broken affordance without dropping the signal. House/LLM
        // questions carry a null creatorId and must stay.
        or(isNull(questions.creatorId), ne(questions.creatorId, userId)),
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

// --- From Friends activity log (D-FEED-FRIEND-ACTIVITY-01) --------------------

// Wider than the milestone window so a play can still reach its held-singles
// 5-day solo release before its source row ages out of the scan.
const FRIEND_ACTIVITY_WINDOW_DAYS = 35;

// Map the FeedItem `sourceAnswerId` prefix to the originating play surface.
// Unknown / legacy / null ids fall back to 'feed' (a time-gap burst) so no play
// is dropped. The full id format lives in create-feed-items-for-answer.ts.
function parsePlayContext(sourceAnswerId: string | null): PlayContext {
  if (!sourceAnswerId) return 'feed';
  const prefix = sourceAnswerId.slice(0, sourceAnswerId.indexOf(':'));
  switch (prefix) {
    case 'daily':
      return 'daily';
    case 'catchup':
      return 'catchup';
    case 'joshing_game':
      return 'joshing_game';
    case 'profile':
      return 'profile';
    default:
      return 'feed';
  }
}

// The natural-unit batch key for daily/catchup/game; null for feed/profile
// (those sessionize into time-gap bursts in the pure derivation). NOTE: the
// `sourceAnswerId` daily form is `daily:${propagationKey}:${userId}` — NOT a
// day — so the daily/catchup batch is keyed on the calendar day of the answer.
// Cut-1 uses the UTC day; a late-night play near midnight could split across
// days under the viewer's tz (open: switch to the app display tz).
function batchKeyFor(
  context: PlayContext,
  answeredAt: Date,
  joshingGameId: string | null,
): string | null {
  switch (context) {
    case 'daily':
    case 'catchup':
      return answeredAt.toISOString().slice(0, 10);
    case 'joshing_game':
      return joshingGameId ?? `game:${answeredAt.toISOString().slice(0, 10)}`;
    case 'feed':
    case 'profile':
      return null;
  }
}

/**
 * From Friends — the chronological activity log that replaces the deep/breadth
 * milestone grouping on this surface (D-FEED-FRIEND-ACTIVITY-01). Same correct-
 * `friend_answered`-from-someone-I-follow rows as `getLatelyMilestones`, but
 * routed by play context into time-and-context cards by the pure
 * `deriveFriendActivity`.
 *
 * Cut-1 scope: `playableForViewer` excludes only the viewer's OWN authored
 * questions (the dead "ANSWER →" button case). Already-answered questions stay
 * in the bundle — build-stream renders them as spent triangles via their prior
 * result, which is what keeps an answered-in-place card alive (Q4). Excluding
 * pre-answered questions and freezing card membership both need persistence and
 * are the documented follow-up (see the spec's Open section).
 */
export async function getFriendActivity(userId: string): Promise<FriendActivityCard[]> {
  const windowStart = new Date(
    Date.now() - FRIEND_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({
      friendId: feedItems.sourceUserId,
      friendDisplayName: users.displayName,
      questionId: feedItems.questionId,
      sourceAnswerId: feedItems.sourceAnswerId,
      joshingGameId: feedItems.joshingGameId,
      creatorId: questions.creatorId,
      answeredAt: feedItems.sourceEventAt,
    })
    .from(feedItems)
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

  const playRows: FriendPlayRow[] = [];
  for (const row of rows) {
    if (!row.questionId || !row.answeredAt) continue;
    const context = parsePlayContext(row.sourceAnswerId);
    const friendName = row.friendDisplayName?.trim() || 'A friend';
    playRows.push({
      friendId: row.friendId,
      friendName,
      friendFirstName: firstName(row.friendDisplayName, friendName),
      questionId: row.questionId,
      answeredAt: row.answeredAt,
      context,
      batchKey: batchKeyFor(context, row.answeredAt, row.joshingGameId),
      // Authored-by-viewer questions are unplayable (the answer route 403s on
      // your own question). Already-answered questions stay (rendered spent).
      playableForViewer: row.creatorId !== userId,
    });
  }

  return deriveFriendActivity(playRows, new Date());
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

  const allowed = collectFriendActivityQuestionIds(await getFriendActivity(userId));
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

// D-4 CORRECTION 2: a milestone, expanded in the unified activity stream, reveals
// the friend's literal questions to ANSWER (full credit via the feed pop-up). The
// stream needs each question's text + display domain to render the collapsed
// one-liner's expansion. These ids come from the viewer's own derived milestones,
// so they're already authorized — answering is separately re-authorized in the
// milestone answer route by construction (getSeededPlayQuestions).
export type MilestoneCardQuestion = {
  questionId: string;
  text: string;
  domain: string | null;
  // Honest authorship for the expanded reveal (D-FEED-GROUP3-01 §4). Shared by
  // milestone bundles and convergence clusters — a house/LLM question in either
  // reveal must be marked, never rendered as if a person wrote it.
  authorName: string | null;
  authorIsHouse: boolean;
};

export async function getMilestoneQuestionText(
  ids: string[],
): Promise<Map<string, MilestoneCardQuestion>> {
  const out = new Map<string, MilestoneCardQuestion>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      creatorId: questions.creatorId,
      source: questions.source,
      authorDisplayName: users.displayName,
      deletedAt: questions.deletedAt,
    })
    .from(questions)
    // creator may be null (house/LLM), so the author join is a left join.
    .leftJoin(users, eq(users.id, questions.creatorId))
    .where(inArray(questions.id, ids));
  for (const row of rows) {
    if (row.deletedAt) continue;
    const author = resolveAuthorDisplay(row.creatorId, row.source, row.authorDisplayName);
    out.set(row.id, {
      questionId: row.id,
      text: row.questionText,
      domain: resolveMilestoneDomain(row.canonicalSubcategory, row.broadCategory, row.category),
      authorName: author.authorName,
      authorIsHouse: author.authorIsHouse,
    });
  }
  return out;
}

// The viewer's own prior result on each of the given questions, if any. Drives
// the milestone expansion's progress on first render AND the cross-session lock:
// a single attempt (right OR wrong) settles the question, so it must report
// incorrect attempts too — reporting only correct ones is what let a
// wrong-answered question re-open as answerable on reload. Correct wins over
// incorrect (mirrors getViewerAnswerStatusForQuestions in feed.ts); a question
// the viewer never attempted is simply absent from the map. Scoped to
// answeredByUserId so author/curator-credit events (a non-answerer's row) never
// count as the viewer's own attempt.
export async function getViewerPriorAnswerResults(
  userId: string,
  ids: string[],
): Promise<Map<string, 'correct' | 'incorrect'>> {
  const out = new Map<string, 'correct' | 'incorrect'>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ questionId: masteryEvents.questionId, answerState: masteryEvents.answerState })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.answeredByUserId, userId),
        inArray(masteryEvents.questionId, ids),
      ),
    );
  for (const row of rows) {
    if (!row.questionId) continue;
    const isCorrect = row.answerState !== null && row.answerState !== 'incorrect';
    if (isCorrect) {
      out.set(row.questionId, 'correct');
    } else if (!out.has(row.questionId)) {
      out.set(row.questionId, 'incorrect');
    }
  }
  return out;
}

// --- Convergence (B-Convergence-1) -------------------------------------------

// Bounds the answer scan. Generous vs. the 14-day cluster window so a recent
// cluster's boundaries stay stable: a cluster only depends on the run of
// co-correct questions since the last reset, which 60 days comfortably covers.
const CONVERGENCE_LOOKBACK_DAYS = 60;

const PAIR_SEP = '\u0000';

// Read-time "same-correct overlap": questions the viewer AND a mutual friend
// both answered correctly, excluding questions either of them authored (those
// are already surfaced as the they_got_you / you_got_them moments). Derived
// entirely from existing masteryEvents — no write path, no migration. The
// firing / reset / single-owner rules live in `@/lib/convergence`.
export async function getLatelyConvergences(
  userId: string,
): Promise<Convergence[]> {
  const lookbackStart = new Date(
    Date.now() - CONVERGENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  // 1. The viewer's correct answers, with each question's author so we can drop
  //    questions the viewer wrote. Keep the EARLIEST correct moment per question.
  const viewerRowsRaw = await db
    .select({
      questionId: masteryEvents.questionId,
      createdAt: masteryEvents.createdAt,
      creatorId: questions.creatorId,
      trustTier: questions.trustTier,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        inArray(masteryEvents.sourceType, LIVE_SOURCE_TYPES),
        inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, lookbackStart),
      ),
    );

  // Tier-gate (B4 Phase 3): a Convergence moment only forms from human_validated|
  // author_confirmed questions. Off by default — shadow-logs and keeps today's set.
  const viewerRows = applyTierGate(
    'convergence',
    viewerRowsRaw,
    (row) => row.trustTier as TrustTier,
    FRIEND_FACING_TIERS,
  ).rows;

  const viewerByQuestion = new Map<
    string,
    { answeredAt: Date; creatorId: string | null }
  >();
  for (const row of viewerRows) {
    if (!row.questionId) continue;
    if (row.creatorId === userId) continue; // viewer authored it -> not "shared"
    const prev = viewerByQuestion.get(row.questionId);
    if (!prev || row.createdAt < prev.answeredAt) {
      viewerByQuestion.set(row.questionId, {
        answeredAt: row.createdAt,
        creatorId: row.creatorId,
      });
    }
  }
  const viewerQuestionIds = [...viewerByQuestion.keys()];
  if (viewerQuestionIds.length === 0) return [];

  // 2. Mutual friends (approved follows in BOTH directions).
  const [following, followers] = await Promise.all([
    db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.state, 'approved'))),
    db
      .select({ id: follows.followerId })
      .from(follows)
      .where(and(eq(follows.followeeId, userId), eq(follows.state, 'approved'))),
  ]);
  const followingIds = new Set(following.map((r) => r.id));
  const mutualIds = [...new Set(followers.map((r) => r.id))].filter((id) =>
    followingIds.has(id),
  );
  if (mutualIds.length === 0) return [];

  // 3. Those friends' correct answers on the viewer's shared question set.
  const friendRows = await db
    .select({
      friendId: masteryEvents.userId,
      questionId: masteryEvents.questionId,
      createdAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .where(
      and(
        inArray(masteryEvents.userId, mutualIds),
        inArray(masteryEvents.questionId, viewerQuestionIds),
        inArray(masteryEvents.sourceType, LIVE_SOURCE_TYPES),
        inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
        isNotNull(masteryEvents.questionId),
        gte(masteryEvents.createdAt, lookbackStart),
      ),
    );

  const friendByPair = new Map<string, Date>(); // friendId\0questionId -> earliest
  for (const row of friendRows) {
    if (!row.questionId || !row.friendId) continue;
    const key = `${row.friendId}${PAIR_SEP}${row.questionId}`;
    const prev = friendByPair.get(key);
    if (!prev || row.createdAt < prev) friendByPair.set(key, row.createdAt);
  }
  if (friendByPair.size === 0) return [];

  // 4. Friend display names.
  const nameRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, mutualIds));
  const nameById = new Map(nameRows.map((r) => [r.id, r.displayName]));

  // 5. Build co-correct rows, excluding questions the FRIEND authored.
  const rows: ConvergenceCoCorrectRow[] = [];
  for (const [key, friendAnsweredAt] of friendByPair) {
    const sep = key.indexOf(PAIR_SEP);
    const friendId = key.slice(0, sep);
    const questionId = key.slice(sep + 1);
    const viewer = viewerByQuestion.get(questionId);
    if (!viewer) continue;
    if (viewer.creatorId === friendId) continue; // friend authored it -> not "shared"
    const displayName = nameById.get(friendId) ?? null;
    rows.push({
      friendId,
      friendName: displayName ?? 'A friend',
      friendFirstName: firstName(displayName, 'A friend'),
      questionId,
      viewerAnsweredAt: viewer.answeredAt,
      friendAnsweredAt,
    });
  }

  return deriveConvergences(userId, rows);
}
