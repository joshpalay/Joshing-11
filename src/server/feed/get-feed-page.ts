/**
 * Server-side feed page builder.
 *
 * This is the single source of truth for the shape returned to clients on
 * /api/feed. The HTTP handler at src/app/api/feed/route.ts is a thin wrapper
 * around getFeedPagePayload; the homepage server component calls it directly
 * to hydrate <FeedList /> with the first page (no client round-trip).
 */

import { and, count, eq, inArray, isNull, ne, notExists, or } from 'drizzle-orm';

import { db, feedItems, follows, masteryEvents, questions, users } from '@/server/db';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import {
  getDismissedDomains,
  getFeedForUser,
  questionVisibilityPredicate,
  type CollapsedFeedItem,
  type FeedCursor,
  type FeedFilter,
} from '@/server/db/queries/feed';
import {
  DIRECT_SENT_FEED_SOURCE_TYPE,
  socialFeedDomainLabel,
  visibleFeedSourcePredicate,
} from '@/server/feed/visibility';

const visibleSourcePredicate = visibleFeedSourcePredicate(feedItems);

const feedQuestionSelectColumns = {
  id: questions.id,
  questionText: questions.questionText,
  answerText: questions.answerText,
  creatorId: questions.creatorId,
  source: questions.source,
  explainerBrief: questions.explainerBrief,
  factualExplanation: questions.factualExplanation,
  canonicalSubcategory: questions.canonicalSubcategory,
  broadCategory: questions.broadCategory,
  category: questions.category,
};

async function selectFeedQuestions(questionIds: string[]) {
  return questionIds.length
    ? db.select(feedQuestionSelectColumns).from(questions).where(inArray(questions.id, questionIds))
    : Promise.resolve([]);
}

export function encodeFeedCursor(cursor: FeedCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify({
    source_event_at: cursor.sourceEventAt.toISOString(),
    id: cursor.id,
  })).toString('base64url');
}

export function decodeFeedCursor(value: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      source_event_at?: unknown;
      id?: unknown;
    };
    if (typeof parsed.source_event_at !== 'string' || typeof parsed.id !== 'string') return null;

    const sourceEventAt = new Date(parsed.source_event_at);
    if (Number.isNaN(sourceEventAt.getTime()) || parsed.id.trim().length === 0) return null;

    return { sourceEventAt, id: parsed.id };
  } catch {
    return null;
  }
}

type UserDisplay = { displayName: string | null; slug?: string | null };

function humanizeSlug(slug: string | null | undefined): string | null {
  const trimmed = slug?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[-_]+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function displayName(user: UserDisplay | null | undefined, fallback = 'A friend') {
  const name = user?.displayName?.trim();
  if (name) return name;
  const fromSlug = humanizeSlug(user?.slug);
  if (fromSlug) return fromSlug;
  return fallback;
}

function authoredSharedAttribution(sourceName: string, domain: string | null): string {
  return domain ? `${sourceName} shared a question — ${domain}` : `${sourceName} shared a question`;
}

function directSentAttribution(sourceName: string, domain: string | null): string {
  return domain ? `${sourceName} sent you a question — ${domain}` : `${sourceName} sent you a question`;
}

function feedFilterSourcePredicate(filter: FeedFilter) {
  if (filter === 'sent-to-me') return eq(feedItems.sourceType, DIRECT_SENT_FEED_SOURCE_TYPE);
  if (filter === 'from-friends') {
    // D-1 Stage 5: friend_answered no longer renders. Broadcasts = authored_shared
    // (friend_added envelope) + legacy thumbs_upped.
    return inArray(feedItems.sourceType, ['authored_shared', 'thumbs_upped']);
  }
  return undefined;
}

// D-1 Stage 5: friend_answered is no longer a feed card. The remaining source
// types map explicitly; any unexpected/legacy row falls back to the friend_added
// (authored_shared) broadcast envelope rather than throwing, so a stray row can
// never crash the feed.
function feedCardType(item: CollapsedFeedItem): 'direct_sent' | 'friend_added' | 'friend_liked' | 'answered_by_you' {
  if (item.state === 'answered') return 'answered_by_you';
  if (item.sourceType === DIRECT_SENT_FEED_SOURCE_TYPE) return 'direct_sent';
  if (item.sourceType === 'thumbs_upped') return 'friend_liked';
  return 'friend_added';
}

function compactNulls<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null) result[key] = value;
  }
  return result as T;
}

export type FeedPageOptions = {
  limit: number;
  cursor: FeedCursor | null;
  filter: FeedFilter;
};

// Count of items the viewer can still act on in a given surface, mirroring the
// visibility rules getFeedForUser applies (active/skipped state, source-type
// visibility, question visibility, not-self-authored, and the already-answered
// hide for non-direct_sent). Used for the per-tab badge counts and the active
// filter's pre_filter_active_count.
function surfaceActionableCount(viewerUserId: string, filter: FeedFilter): Promise<number> {
  return db
    .select({ value: count() })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(and(
      eq(feedItems.recipientUserId, viewerUserId),
      visibleSourcePredicate,
      feedFilterSourcePredicate(filter),
      inArray(feedItems.state, ['active', 'skipped']),
      questionVisibilityPredicate(viewerUserId),
      or(isNull(questions.creatorId), ne(questions.creatorId, viewerUserId)),
      or(
        eq(feedItems.sourceType, 'direct_sent'),
        notExists(
          db
            .select({ id: masteryEvents.id })
            .from(masteryEvents)
            .where(and(
              eq(masteryEvents.userId, viewerUserId),
              eq(masteryEvents.answeredByUserId, viewerUserId),
              eq(masteryEvents.questionId, feedItems.questionId),
            )),
        ),
      ),
    ))
    .then((rows) => rows[0]?.value ?? 0);
}

export type FeedPagePayload = Awaited<ReturnType<typeof getFeedPagePayload>>;

export async function getFeedPagePayload(viewerUserId: string, options: FeedPageOptions) {
  const { limit, cursor, filter } = options;

  const [
    feedPage,
    friendCount,
    dismissedDomains,
    totalItemCount,
    preFilterActiveCount,
    broadcastsItemCount,
    sentItemCount,
  ] = await Promise.all([
    getFeedForUser(viewerUserId, { limit, cursor, filter }),
    // "has_friends" empty-state signal: people I follow are exactly the
    // authors who can populate my feed, so an approved-outbound-follow count
    // is the right, single-index proxy (D-1 Stage 3 follow model).
    db
      .select({ value: count() })
      .from(follows)
      .where(and(
        eq(follows.followerId, viewerUserId),
        eq(follows.state, 'approved'),
      ))
      .then((rows) => rows[0]?.value ?? 0),
    getDismissedDomains(viewerUserId),
    db
      .select({ value: count() })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(and(
        eq(feedItems.recipientUserId, viewerUserId),
        visibleSourcePredicate,
        feedFilterSourcePredicate(filter),
        questionVisibilityPredicate(viewerUserId),
        or(isNull(questions.creatorId), ne(questions.creatorId, viewerUserId)),
      ))
      .then((rows) => rows[0]?.value ?? 0),
    // Active filter's actionable count (drives the focused-feed empty state).
    surfaceActionableCount(viewerUserId, filter),
    // D-1 Stage 5: both tab badges must be live on every response, regardless of
    // which surface is active.
    surfaceActionableCount(viewerUserId, 'from-friends'),
    surfaceActionableCount(viewerUserId, 'sent-to-me'),
  ]);

  const activeItemCount = feedPage.totalCount;
  const feed = feedPage.items;
  const pageItemCount = feedPage.items.length;
  const nextCursor = encodeFeedCursor(feedPage.nextCursor);
  const questionIds = feed.map((item) => item.questionId).filter((id): id is string => Boolean(id));

  const [questionRows, bankedById] = await Promise.all([
    selectFeedQuestions(questionIds),
    checkBankedQuestions(viewerUserId, questionIds),
  ]);

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const userIds = [...new Set([
    ...feed.map((item) => item.sourceUserId),
    ...questionRows.map((question) => question.creatorId).filter((id): id is string => Boolean(id)),
  ])];
  const userRows = userIds.length
    ? await db.select({ id: users.id, displayName: users.displayName, slug: users.slug }).from(users).where(inArray(users.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return {
    viewer_user_id: viewerUserId,
    meta: {
      has_friends: friendCount > 0,
      has_dismissed_domains: dismissedDomains.length > 0,
      total_item_count: totalItemCount,
      active_item_count: activeItemCount,
      pre_filter_active_count: preFilterActiveCount,
      broadcasts_item_count: broadcastsItemCount,
      sent_item_count: sentItemCount,
      page_item_count: pageItemCount,
      limit,
      cursor: cursor ? encodeFeedCursor(cursor) : null,
      next_cursor: nextCursor,
      has_more: feedPage.hasMore,
      filter,
    },
    next_cursor: nextCursor,
    has_more: feedPage.hasMore,
    items: feed.map((item) => {
      const question = item.questionId ? questionById.get(item.questionId) : undefined;
      const sourceUser = userById.get(item.sourceUserId);
      const sourceName = displayName(sourceUser);
      const domain = socialFeedDomainLabel(question);
      const cardType = feedCardType(item);
      // Fall back to viewer's mastery-event answer status when answerResult is null
      // (legacy feed items answered before the answerResult column was added).
      const answerResult = item.answerResult ?? item.viewerAnswerStatus?.result ?? null;
      const awardedPoints = typeof item.pointsAwarded === 'number' ? item.pointsAwarded : null;

      // compactNulls strips `"field":null` from the wire; the client treats
      // absent fields and null fields identically (verified by grep:
      // no `=== null` checks on these fields, only `??`, optional chaining,
      // and truthy checks). Card-discriminated fields are the bulk of the
      // saving — `joshing_game_id`, `endorsement_count`, `correct_answer`
      // etc. are null on 4 of 5 card types each.
      return compactNulls({
        id: item.id,
        kind: 'question' as const,
        card_type: cardType,
        question_id: item.questionId,
        joshing_game_id: item.joshingGameId,
        source_type: item.sourceType,
        source_user_id: item.sourceUserId,
        source_result: item.sourceResult ?? null,
        source_friend_display_name: sourceName,
        source_profile_href: `/users/${encodeURIComponent(item.sourceUserId)}`,
        source_attribution: item.sourceType === 'authored_shared'
          ? authoredSharedAttribution(sourceName, domain)
          : item.sourceType === DIRECT_SENT_FEED_SOURCE_TYPE
            ? directSentAttribution(sourceName, domain)
            : sourceName,
        viewer_answer_status: item.viewerAnswerStatus ?? null,
        endorsement_count: item.thumbsUpCount ?? null,
        additional_endorsers: item.additionalEndorsers ?? null,
        source_event_at: item.sourceEventAt instanceof Date
          ? item.sourceEventAt.toISOString()
          : item.sourceEventAt,
        personal_message: item.personalMessage,
        state: item.state,
        is_pinned: item.isPinned,
        question_text: question?.questionText ?? null,
        // B-6: question provenance so the recipient-facing verb reflects who
        // actually authored the question (human-authored vs curated LLM), not
        // the feed item's send mechanism. Only an explicit 'authored' source
        // ever reads as human authorship downstream; everything else defaults
        // to the curated verb (B-5: a curated/LLM send must never imply a human
        // wrote it).
        question_source: question?.source ?? null,
        is_in_bank: item.questionId ? Boolean(bankedById[item.questionId]) : false,
        explanation: question?.explainerBrief ?? question?.factualExplanation ?? null,
        domain_pill: domain,
        broad_category: question?.broadCategory ?? null,
        answer_result: answerResult,
        is_correct: answerResult === null ? null : answerResult === 'correct',
        correct_answer: cardType === 'answered_by_you' ? question?.answerText ?? null : null,
        submitted_answer: cardType === 'answered_by_you' ? item.submittedAnswer ?? null : null,
        awarded_points: cardType === 'answered_by_you' ? awardedPoints : null,
        mastery_delta: cardType === 'answered_by_you' ? item.masteryDelta ?? null : null,
        viewer_is_author: question?.creatorId ? question.creatorId === viewerUserId : false,
      });
    }),
  };
}
