import { and, desc, eq, gte, inArray, isNotNull, isNull, like, ne, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

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
import { db, feedItems, follows, masteryEvents, milestoneDismissed, questions, users } from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';
import { approvedFollowExists, mutualFollowApproved } from '@/server/db/queries/follow-visibility';
import { ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES, SOCIAL_FEED_SOURCE_TYPE, notBlocked, notBlockedForViewer } from '@/server/feed/visibility';

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

// The Lately/`/activities` full list scans the default 30-day moment horizon;
// the home edition passes HOME_WINDOW_DAYS to bound the ambient band (D-HOME-
// DASHBOARD-MODEL-01). Defaulted so non-home callers are unchanged.
const MOMENTS_WINDOW_DAYS = 30;

export async function getLatelyMoments(
  userId: string,
  windowDays = MOMENTS_WINDOW_DAYS,
): Promise<LatelyMoment[]> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

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
        gte(masteryEvents.createdAt, windowStart),
        // Safety hard-block: a blocked question must not resurface as a moment,
        // except to its own author (they_got_you rows are the viewer's own
        // authored question) — the owner exception.
        notBlockedForViewer(userId),
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

// A bundle answer: the viewer answered a question they met through a friend's
// From Friends bundle (via /api/lately/milestone/answer). The friend PLAYED the
// question — their correct `friend_answered` feed row is what put it in the
// bundle — but nobody-the-viewer-knows WROTE it: these are the creator-less LLM
// questions `getLatelyMoments` excludes by construction. Without this read the
// answer leaves no activity trace at all (the exhausted bundle also disappears
// from From Friends), so "the last thing I did" is invisible on Home.
// Human-authored bundle questions are deliberately NOT read here — they already
// surface as you_got_them moments, and reading them again would double the row.
export type BundleAnswerMoment = {
  momentId: string;
  friendId: string;
  friendName: string;
  friendFirstName: string;
  questionId: string;
  questionText: string;
  category: string;
  answeredAt: Date;
};

export async function getBundleAnswerMoments(
  userId: string,
  windowDays = MOMENTS_WINDOW_DAYS,
): Promise<BundleAnswerMoment[]> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      momentId: masteryEvents.id,
      friendId: feedItems.sourceUserId,
      friendDisplayName: users.displayName,
      questionId: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
      answeredAt: masteryEvents.createdAt,
      playedAt: feedItems.sourceEventAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    // The friend whose bundle carried this question: the same correct
    // `friend_answered` row getFriendActivity builds the bundle from. Two
    // friends can both have played it — the JS pass below keeps the most
    // recent play per mastery event.
    .innerJoin(
      feedItems,
      and(
        eq(feedItems.questionId, masteryEvents.questionId),
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
        eq(feedItems.sourceResult, 'correct'),
      ),
    )
    .innerJoin(users, eq(users.id, feedItems.sourceUserId))
    .where(
      and(
        eq(masteryEvents.userId, userId),
        // The milestone answer route's deterministic answer id is the marker
        // that this event came from a bundle answer: write-mastery-event
        // composes `${sourceType}:${sourceId}:…` and that route passes
        // sourceType 'feed' with sourceId `milestone:{questionId}`.
        like(masteryEvents.answerId, 'feed:milestone:%'),
        inArray(masteryEvents.answerState, CORRECT_ANSWER_STATES),
        gte(masteryEvents.createdAt, windowStart),
        // Creator-less (LLM) questions only — human-authored bundle answers
        // already read as you_got_them moments in getLatelyMoments; this query
        // is the complement, never an overlap.
        isNull(questions.creatorId),
        // Safety hard-block (no owner exception possible on a creator-less
        // question, so the plain form suffices).
        notBlocked(),
        // Bundle membership is friends-only (mutual), same gate as the bundle
        // reads in getFriendActivity/getLatelyMilestones.
        mutualFollowApproved(userId, feedItems.sourceUserId, 'bundle_answer'),
      ),
    )
    .orderBy(desc(masteryEvents.createdAt), desc(feedItems.sourceEventAt))
    .limit(200);

  const seen = new Set<string>();
  const moments: BundleAnswerMoment[] = [];
  for (const row of rows) {
    if (!row.answeredAt || !row.friendId) continue;
    // Rows arrive newest-play-first within each event; keep the first (most
    // recent) friend per mastery event.
    if (seen.has(row.momentId)) continue;
    seen.add(row.momentId);
    const friendName = row.friendDisplayName?.trim() || 'A friend';
    moments.push({
      momentId: row.momentId,
      friendId: row.friendId,
      friendName,
      friendFirstName: firstName(row.friendDisplayName, friendName),
      questionId: row.questionId,
      questionText: row.questionText,
      category: prettifyCategory(row.canonicalSubcategory, row.category),
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
export async function getLatelyMilestones(
  userId: string,
  windowDays = MILESTONE_WINDOW_DAYS,
): Promise<LatelyMilestone[]> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

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
    // sourceUserId ∈ {my friends}: inner-join the forward approved follow edge
    // (viewer -> friend); the reverse edge is required in WHERE so a milestone
    // only surfaces for a MUTUAL friend, never a one-directional follow.
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
        // Reverse half of the mutual-friendship gate (friend -> viewer approved).
        approvedFollowExists(feedItems.sourceUserId, userId, 'milestone_mutual'),
        // Safety hard-block: blocked questions never anchor a milestone (the
        // owner exception is moot here — viewer-authored is excluded below).
        notBlockedForViewer(userId),
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
export async function getFriendActivity(
  userId: string,
  // Defaulted to the 35-day scan for the /from-friends overflow page and any
  // other non-home caller; the home edition passes HOME_WINDOW_DAYS to bound
  // the ambient band (D-HOME-DASHBOARD-MODEL-01).
  windowDays = FRIEND_ACTIVITY_WINDOW_DAYS,
): Promise<FriendActivityCard[]> {
  const windowStart = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  );

  // A question the viewer has been DELIBERATELY handed — a direct send or a
  // broadcast (any ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES row in their rendered
  // Feed inbox) — belongs to the top "For You" / Sent surface, not the ambient
  // From-Friends band. Suppress it here so a send moves the question OUT of From
  // Friends and INTO the Feed rather than showing it in both. Scoped to
  // still-present rows (a rolled-off send relinquishes its claim, so From Friends
  // may reclaim the question). Dropping it can shrink a friend's daily batch below
  // the 2-question floor, which naturally holds/retires the card — the intended
  // effect.
  const deliveredToInbox = alias(feedItems, 'delivered_to_inbox');
  // D-4 via-attribution: the relay source ("via Josh") rides on the SAME feed row
  // we're already reading (it's who the answering friend got the question from).
  // A second users alias resolves that source's display name in the same query —
  // left-joined because viaUserId is null for organically-met questions.
  const viaUser = alias(users, 'via_user');

  const rows = await db
    .select({
      friendId: feedItems.sourceUserId,
      friendDisplayName: users.displayName,
      questionId: feedItems.questionId,
      sourceAnswerId: feedItems.sourceAnswerId,
      joshingGameId: feedItems.joshingGameId,
      creatorId: questions.creatorId,
      answeredAt: feedItems.sourceEventAt,
      viaUserId: feedItems.viaUserId,
      viaName: viaUser.displayName,
    })
    .from(feedItems)
    // Forward half of the friendship check: viewer -> friend approved. The
    // reverse half (friend -> viewer) is enforced in WHERE so a one-directional
    // approved edge can't leak a non-friend's activity (Phase 1: friend = mutual).
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
    .leftJoin(viaUser, eq(viaUser.id, feedItems.viaUserId))
    .where(
      and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
        eq(feedItems.sourceResult, 'correct'),
        isNotNull(feedItems.questionId),
        gte(feedItems.sourceEventAt, windowStart),
        // Reverse half of the mutual-friendship gate: the friend must follow the
        // viewer back. Together with the forward join above this requires an
        // approved edge in BOTH directions.
        approvedFollowExists(feedItems.sourceUserId, userId, 'from_friends_mutual'),
        // Safety hard-block: a blocked question must not resurface in the
        // From-Friends log, except to its own author (a friend answering the
        // viewer's own question lands here as a spent card) — the owner exception.
        notBlockedForViewer(userId),
        // Hand-off to the Feed: hide questions the viewer was sent/broadcast.
        notExists(
          db
            .select({ one: sql`1` })
            .from(deliveredToInbox)
            .where(
              and(
                eq(deliveredToInbox.recipientUserId, userId),
                eq(deliveredToInbox.questionId, feedItems.questionId),
                inArray(deliveredToInbox.sourceType, [...ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES]),
                ne(deliveredToInbox.state, 'rolled_off'),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(feedItems.sourceEventAt))
    .limit(500);

  // Relay source per (friend, question) — keyed so two friends who both relayed
  // the same question keep their own "via". Rows arrive newest-first, so the
  // first write per key is the most-recent relay. A "via you" is dropped (the
  // viewer discovering themselves as the source is pointless).
  const viaByFriendQuestion = new Map<string, { userId: string; name: string }>();
  for (const row of rows) {
    if (!row.questionId || !row.viaUserId || row.viaUserId === userId) continue;
    const key = `${row.friendId}:${row.questionId}`;
    if (!viaByFriendQuestion.has(key)) {
      viaByFriendQuestion.set(key, {
        userId: row.viaUserId,
        name: row.viaName?.trim() || 'A friend',
      });
    }
  }

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

  const cards = deriveFriendActivity(playRows, new Date());

  // Attach the relay source per card. Cards are friend-scoped (a fixed friendId)
  // and the via is per (friend, question), so the lookup is exact for every card
  // shape — burst, daily batch, or flushed held-singles. Cards with no relayed
  // question carry no viaByQuestionId at all.
  for (const card of cards) {
    let via: Record<string, { userId: string; name: string }> | undefined;
    for (const questionId of card.questionIds) {
      const source = viaByFriendQuestion.get(`${card.friendId}:${questionId}`);
      if (source) (via ??= {})[questionId] = source;
    }
    if (via) card.viaByQuestionId = via;
  }

  return cards;
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
    .where(
      and(
        inArray(questions.id, authorizedIds),
        // AUTHORSHIP-EXCLUSION INVARIANT (B-CRAFTER-LIFECYCLE-01 Phase 3): a
        // question is never served to its own author. Friend-activity scoping
        // already makes this structurally unlikely here, but with player
        // authoring live the explicit predicate is load-bearing. NULL creators
        // (house/LLM rows) must still pass — hence the isNull arm.
        or(isNull(questions.creatorId), ne(questions.creatorId, userId)),
      ),
    );

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

// --- Milestone dismiss (dismiss-as-answered) ---------------------------------
//
// A viewer waving a From Friends milestone question off. NEUTRAL by design: it
// writes only the MilestoneDismissed row and never touches mastery/points, so a
// dismiss is not a wrong answer — but it counts toward the bundle's consumed
// progress exactly like an answer (build-stream excludes dismissed questions
// from a bundle's `remaining`), so a fully answered-or-dismissed bundle
// disappears on the next load. Reversible via reinstateMilestoneQuestion (undo).
// Mirrors the recovered-set-aside soft-dismiss (queries/recovered-questions.ts).

/**
 * The viewer's actively-dismissed milestone question ids (reinstatedAt IS NULL),
 * scoped to `ids` when given. Read-only, and resilient to the table not existing
 * yet: a pre-migration database returns an empty set rather than failing the
 * whole Home load (mirrors getSetAsideQuestionIds' 42P01 handling).
 */
export async function getViewerDismissedMilestoneIds(
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await db
      .select({ questionId: milestoneDismissed.questionId })
      .from(milestoneDismissed)
      .where(
        and(
          eq(milestoneDismissed.userId, userId),
          inArray(milestoneDismissed.questionId, ids),
          isNull(milestoneDismissed.reinstatedAt),
        ),
      );
    return new Set(rows.map((r) => r.questionId));
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return new Set(); // table not yet migrated
    throw error;
  }
}

/**
 * Dismiss a milestone question for the viewer (reversible soft-dismiss). A no-op
 * if it is already dismissed. The partial unique index guarantees at most one
 * active row per (user, question). Mirrors setAsideRecoveredQuestion.
 */
export async function dismissMilestoneQuestion(userId: string, questionId: string): Promise<void> {
  const [existing] = await db
    .select({ id: milestoneDismissed.id })
    .from(milestoneDismissed)
    .where(
      and(
        eq(milestoneDismissed.userId, userId),
        eq(milestoneDismissed.questionId, questionId),
        isNull(milestoneDismissed.reinstatedAt),
      ),
    )
    .limit(1);

  if (existing) return;

  await db.insert(milestoneDismissed).values({ userId, questionId });
}

/**
 * Undo a dismiss (bring the question back) by marking the active row reinstated.
 * A no-op if it was not dismissed. Mirrors restoreRecoveredQuestion.
 */
export async function reinstateMilestoneQuestion(userId: string, questionId: string): Promise<void> {
  await db
    .update(milestoneDismissed)
    .set({ reinstatedAt: new Date() })
    .where(
      and(
        eq(milestoneDismissed.userId, userId),
        eq(milestoneDismissed.questionId, questionId),
        isNull(milestoneDismissed.reinstatedAt),
      ),
    );
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
  windowDays = CONVERGENCE_LOOKBACK_DAYS,
): Promise<Convergence[]> {
  const lookbackStart = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
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
