import { and, count, desc, eq, inArray, isNull, lt, ne, notExists, notInArray, or, sql } from 'drizzle-orm';

import { db, feedItems, masteryEvents, questions, users } from '@/server/db';
import { mutualFollowApproved } from '@/server/db/queries/follow-visibility';
import { ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES, notBlocked, visibleFeedSourcePredicate } from '@/server/feed/visibility';
import { pgErrorCode, pgErrorMessage } from '@/server/db/pg-error';

export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
export type FeedItemState = 'active' | 'answered' | 'skipped' | 'dismissed' | 'rolled_off' | 'played';

export type ViewerAnswerStatus = { result: 'correct' | 'incorrect' };

export type CollapsedFeedItem = FeedItem & {
  // legacy thumbs_upped collapse
  thumbsUpCount?: number;
  additionalEndorsers?: Array<{ userId: string; displayName: string }>;
  // Viewer's own answer status on the underlying question, regardless of how they answered it.
  // Distinct from item.state === 'answered', which only reflects answering THIS feed item.
  viewerAnswerStatus?: ViewerAnswerStatus | null;
};

const VISIBLE_FEED_STATES = ['active', 'skipped', 'answered'] as const;
const ACTION_REQUIRED_FEED_STATES = ['active', 'skipped'] as const;
const BLOCKING_FEED_STATES = ['active', 'skipped', 'dismissed'] as const;
// Homepage feed inbox: only items the viewer can still act on.
// Answered cards stay in the client's local React state for the current
// page session (see FeedList.submitAnswer) and disappear on next load.
const ACTIONABLE_FEED_STATES = ACTION_REQUIRED_FEED_STATES;

const visibleSourcePredicate = visibleFeedSourcePredicate(feedItems);

const feedItemCompatibilityColumns = {
  id: feedItems.id,
  recipientUserId: feedItems.recipientUserId,
  questionId: feedItems.questionId,
  joshingGameId: feedItems.joshingGameId,
  sourceType: feedItems.sourceType,
  sourceUserId: feedItems.sourceUserId,
  sourceResult: feedItems.sourceResult,
  // D-4 via-attribution (0084). NULL in the compatibility projection so a
  // preview/prod DB that hasn't applied 0084 yet still reads cleanly (mirrors
  // sourceAnswerId below); the boot guard backfills the real column.
  viaUserId: sql<string | null>`NULL`.as('viaUserId'),
  sourceEventAt: feedItems.sourceEventAt,
  personalMessage: feedItems.personalMessage,
  submittedAnswer: feedItems.submittedAnswer,
  answerResult: sql<'correct' | 'incorrect' | null>`NULL`.as('answerResult'),
  pointsAwarded: sql<number | null>`NULL`.as('pointsAwarded'),
  masteryDelta: sql<Record<string, unknown> | null>`NULL`.as('masteryDelta'),
  sourceAnswerId: sql<string | null>`NULL`.as('sourceAnswerId'),
  state: feedItems.state,
  isPinned: feedItems.isPinned,
  createdAt: feedItems.createdAt,
};

function isMissingOptionalFeedColumn(error: unknown): boolean {
  if (pgErrorCode(error) !== '42703') return false;

  const message = pgErrorMessage(error) ?? (error instanceof Error ? error.message : String(error));
  return ['answerResult', 'pointsAwarded', 'masteryDelta', 'sourceAnswerId', 'viaUserId'].some((column) =>
    message.includes(column),
  );
}

// Legacy thumbs_upped collapsing (for items already in the DB)
async function collapseThumbsUpItems(items: FeedItem[]): Promise<FeedItem[]> {
  const groups = new Map<string, FeedItem[]>();
  items.forEach((item) => {
    if (item.sourceType !== 'thumbs_upped' || !item.questionId) return;
    const key = item.questionId;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  if (groups.size === 0) return items;

  const hiddenIds = new Set<string>();
  const collapsedById = new Map<string, CollapsedFeedItem>();
  const additionalUserIds = new Set<string>();

  groups.forEach((group) => {
    if (group.length <= 1) return;
    const [mostRecent, ...older] = [...group].sort((a, b) => b.sourceEventAt.getTime() - a.sourceEventAt.getTime());
    older.forEach((item) => { hiddenIds.add(item.id); additionalUserIds.add(item.sourceUserId); });
    collapsedById.set(mostRecent.id, {
      ...mostRecent,
      thumbsUpCount: group.length,
      additionalEndorsers: older.map((item) => ({ userId: item.sourceUserId, displayName: 'A friend' })),
    });
  });

  if (additionalUserIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...additionalUserIds]));
    const nameById = new Map(userRows.map((u) => [u.id, u.displayName?.trim() || 'A friend']));
    collapsedById.forEach((item) => {
      item.additionalEndorsers = item.additionalEndorsers?.map((e) => ({
        ...e,
        displayName: nameById.get(e.userId) ?? 'A friend',
      }));
    });
  }

  return items.filter((item) => !hiddenIds.has(item.id)).map((item) => collapsedById.get(item.id) ?? item);
}

// Feed-mute ("hide category from feed") was retired — the mute action, its
// management box, and the dismiss-domain API routes are gone. The
// FeedDismissedDomain table and its friend-side write skips
// (create-feed-items-for-answer, questions share, friend-coverage) remain as
// dormant plumbing; the home-feed read no longer filters by it (see
// getFeedForUser), so existing dismissed rows no longer hide anything here.

export type FeedCursor = {
  sourceEventAt: Date;
  id: string;
};

export type FeedFilter = 'all' | 'sent-to-me' | 'from-friends';

type FeedForUserOptions = {
  limit?: number;
  cursor?: FeedCursor | null;
  filter?: FeedFilter;
};

export type PaginatedFeedResult = {
  items: CollapsedFeedItem[];
  nextCursor: FeedCursor | null;
  hasMore: boolean;
  totalCount: number;
  // The viewer's dismissed domains, surfaced so callers (getFeedPagePayload)
  // can reuse them for the `has_dismissed_domains` flag instead of issuing a
  // second identical getDismissedDomains query on the same request.
  dismissedDomains: string[];
};

const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;

function normalizeFeedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_FEED_LIMIT;
  return Math.min(Math.max(Math.trunc(limit!), 1), MAX_FEED_LIMIT);
}


function feedFilterPredicate(filter: FeedFilter | undefined, pinned?: boolean) {
  // Pinned items are questions a friend addressed directly to you (only
  // direct_sent rows are pinned today). They lead EVERY surface — including the
  // default Broadcasts tab — so a sent question is never hidden behind the Sent
  // tab. The surface filter therefore does not apply to the pinned fetch.
  if (pinned) return eq(feedItems.sourceType, 'direct_sent');
  if (filter === 'sent-to-me') return eq(feedItems.sourceType, 'direct_sent');
  if (filter === 'from-friends') {
    // D-1 Stage 5: friend_answered no longer renders. Broadcasts = authored_shared
    // (friend_added envelope) + legacy thumbs_upped.
    return inArray(feedItems.sourceType, ['authored_shared', 'thumbs_upped']);
  }
  return undefined;
}

function feedPinnedPredicate(pinned: boolean | undefined) {
  if (pinned) {
    return and(eq(feedItems.isPinned, true), inArray(feedItems.state, ACTION_REQUIRED_FEED_STATES));
  }

  return eq(feedItems.isPinned, false);
}

// Hide non-direct_sent items for questions the viewer has already answered
// elsewhere (joshing game, catchup, an earlier feed card). direct_sent stays
// — a friend addressed it to them specifically, and the server allows
// re-grade on direct_sent so the card stays useful.
function viewerNotAlreadyAnsweredPredicate(userId: string) {
  return or(
    eq(feedItems.sourceType, 'direct_sent'),
    notExists(
      db
        .select({ id: masteryEvents.id })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          eq(masteryEvents.answeredByUserId, userId),
          eq(masteryEvents.questionId, feedItems.questionId),
        )),
    ),
  );
}

function feedCursorPredicate(cursor: FeedCursor | null | undefined) {
  if (!cursor) return undefined;

  return or(
    lt(feedItems.sourceEventAt, cursor.sourceEventAt),
    and(
      eq(feedItems.sourceEventAt, cursor.sourceEventAt),
      lt(feedItems.id, cursor.id),
    ),
  );
}

// Render-time question visibility (D-1 Stage 4). 'public' renders for anyone;
// 'friends' is friends-only and renders only when the viewer and the author are
// MUTUAL friends (an approved follow edge in BOTH directions); 'private' is
// author-only and never reaches another viewer's feed (the author is also
// excluded by viewerNotAuthorPredicate). Phase 1: "friend" is bidirectional, so
// a one-directional follow does NOT unlock a 'friends'-visibility question.
// Exported so the empty-state diagnostic counts in get-feed-page.ts apply the
// identical rule and stay in sync with what actually renders.
export function questionVisibilityPredicate(viewerUserId: string) {
  return or(
    eq(questions.visibility, 'public'),
    and(
      eq(questions.visibility, 'friends'),
      mutualFollowApproved(viewerUserId, questions.creatorId, 'question_visibility'),
    ),
  )!;
}

// A question's visibility ('public'/'friends'/'private') gates broadcast/feed
// items, but NOT items addressed directly to the viewer: a direct_sent question
// always renders for its recipient regardless of the question's visibility.
// Without this exemption a 'friends'-visibility question sent straight to a
// recipient who doesn't (yet) follow the author is silently filtered out of
// their feed even though a feed row was written. Mirrors the direct_sent
// special-case in viewerNotAlreadyAnsweredPredicate.
//
// The exemption does NOT extend to 'blocked' (the safety hard-block set by a
// vet verdict or an upheld offensive report): a question can be blocked AFTER
// fan-out — the inline create vet fell back to needs_review on a Haiku error
// and the vet cron caught it later, or an admin upheld a report — and the
// already-written direct_sent rows must stop rendering for their recipients.
//
// Exported so get-feed-page's diagnostic/badge counts apply the identical rule
// and stay in sync with what actually renders.
export function feedItemVisibilityPredicate(viewerUserId: string) {
  return and(
    notBlocked(),
    or(
      eq(feedItems.sourceType, 'direct_sent'),
      questionVisibilityPredicate(viewerUserId),
    ),
  )!;
}

function visibleQuestionPredicate(viewerUserId: string, dismissedDomains: string[]) {
  const predicates = [
    feedItemVisibilityPredicate(viewerUserId),
    isNull(questions.deletedAt),
  ];

  if (dismissedDomains.length > 0) {
    predicates.push(or(
      isNull(questions.canonicalSubcategory),
      notInArray(questions.canonicalSubcategory, dismissedDomains),
    )!);
  }

  return and(...predicates);
}

// Exclude items where the viewer authored the underlying question — they
// already know the answer, so it shouldn't surface as a "question to answer"
// card in their feed. Nullable creatorId (system-generated questions) stays
// visible.
function viewerNotAuthorPredicate(userId: string) {
  return or(isNull(questions.creatorId), ne(questions.creatorId, userId));
}

async function fetchVisibleFeedItems(
  userId: string,
  dismissedDomains: string[],
  options: { limit: number; cursor?: FeedCursor | null; pinned?: boolean; filter?: FeedFilter },
): Promise<FeedItem[]> {
  const cursorPredicate = options.pinned ? undefined : feedCursorPredicate(options.cursor);

  const baseQuery = () => db
    .select({ item: feedItems })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(and(
      eq(feedItems.recipientUserId, userId),
      feedPinnedPredicate(options.pinned),
      visibleSourcePredicate,
      feedFilterPredicate(options.filter, options.pinned),
      inArray(feedItems.state, ACTIONABLE_FEED_STATES),
      visibleQuestionPredicate(userId, dismissedDomains),
      viewerNotAuthorPredicate(userId),
      viewerNotAlreadyAnsweredPredicate(userId),
      cursorPredicate,
    ))
    .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
    .limit(options.limit);

  try {
    const rows = await baseQuery();
    return rows.map((row) => row.item);
  } catch (error) {
    if (!isMissingOptionalFeedColumn(error)) throw error;

    console.warn('[feed/query] Falling back to compatibility FeedItem projection', {
      missingColumnError: pgErrorMessage(error) ?? (error instanceof Error ? error.message : String(error)),
    });

    const rows = await db
      .select({ item: feedItemCompatibilityColumns })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(and(
        eq(feedItems.recipientUserId, userId),
        feedPinnedPredicate(options.pinned),
        visibleSourcePredicate,
        feedFilterPredicate(options.filter, options.pinned),
        inArray(feedItems.state, ACTIONABLE_FEED_STATES),
        visibleQuestionPredicate(userId, dismissedDomains),
        viewerNotAuthorPredicate(userId),
        viewerNotAlreadyAnsweredPredicate(userId),
        cursorPredicate,
      ))
      .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
      .limit(options.limit);

    return rows.map((row) => row.item as FeedItem);
  }
}

export async function getFeedForUser(userId: string, options: FeedForUserOptions = {}): Promise<PaginatedFeedResult> {
  // Feed-mute retired: the home feed no longer filters by dismissed domains.
  // The predicate still accepts a list (empty here) so the shape is unchanged.
  const dismissedDomains: string[] = [];
  const limit = normalizeFeedLimit(options.limit);
  const filter = options.filter ?? 'all';
  const isFirstPage = !options.cursor;

  // Pinned items are deliberately returned only on the first page, ahead of the chronological feed.
  // The totalCount query is also gated to first-page requests: it re-evaluates the same heavy
  // visibility predicate (notExists masteryEvents join, etc.) as the page query, and its only
  // downstream consumer is the empty-state copy in FeedList — which can only fire on the first page.
  // Subsequent paginated loads see `totalCount: 0`; this is a sentinel, not an accurate count.
  const [pinned, nonPinnedRaw, countRows] = await Promise.all([
    isFirstPage
      ? fetchVisibleFeedItems(userId, dismissedDomains, { limit, pinned: true, filter })
      : Promise.resolve([]),
    fetchVisibleFeedItems(userId, dismissedDomains, { limit: limit + 1, cursor: options.cursor, pinned: false, filter }),
    isFirstPage
      ? db
          .select({ value: count() })
          .from(feedItems)
          .innerJoin(questions, eq(feedItems.questionId, questions.id))
          .where(and(
            eq(feedItems.recipientUserId, userId),
            visibleSourcePredicate,
            feedFilterPredicate(filter),
            inArray(feedItems.state, ACTIONABLE_FEED_STATES),
            visibleQuestionPredicate(userId, dismissedDomains),
            viewerNotAuthorPredicate(userId),
            viewerNotAlreadyAnsweredPredicate(userId),
          ))
      : Promise.resolve<{ value: number }[]>([]),
  ]);

  const nonPinnedPage = nonPinnedRaw.slice(0, limit);
  const pageItems = [...pinned, ...nonPinnedPage];
  const collapsed = await collapseThumbsUpItems(pageItems);
  const lastNonPinned = nonPinnedPage.at(-1) ?? null;

  const collapsedQuestionIds = collapsed
    .map((item) => item.questionId)
    .filter((id): id is string => Boolean(id));
  const viewerStatusByQuestion = await getViewerAnswerStatusForQuestions(userId, collapsedQuestionIds);

  const withViewerStatus: CollapsedFeedItem[] = collapsed.map((item) => ({
    ...item,
    viewerAnswerStatus: item.questionId ? viewerStatusByQuestion.get(item.questionId) ?? null : null,
  }));

  return {
    items: withViewerStatus,
    nextCursor: lastNonPinned
      ? { sourceEventAt: lastNonPinned.sourceEventAt, id: lastNonPinned.id }
      : null,
    hasMore: nonPinnedRaw.length > limit,
    totalCount: countRows[0]?.value ?? 0,
    dismissedDomains,
  };
}

export async function createFeedItem(data: NewFeedItem): Promise<FeedItem> {
  const [created] = await db.insert(feedItems).values(data).returning();
  return created;
}

export async function updateFeedItemState(id: string, state: string): Promise<FeedItem | null> {
  const [updated] = await db
    .update(feedItems)
    .set({ state })
    .where(eq(feedItems.id, id))
    .returning();

  return updated ?? null;
}

export async function rollOffOldItems(userId: string): Promise<number> {
  const overflow = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, userId),
      eq(feedItems.isPinned, false),
      inArray(feedItems.state, ACTION_REQUIRED_FEED_STATES),
    ))
    .orderBy(desc(feedItems.sourceEventAt))
    .offset(50);

  if (overflow.length === 0) return 0;

  await db
    .update(feedItems)
    .set({ state: 'rolled_off' })
    .where(inArray(feedItems.id, overflow.map((item) => item.id)));

  return overflow.length;
}

export async function userHasQuestionInVisibleFeed(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, userId),
      eq(feedItems.questionId, questionId),
      inArray(feedItems.state, VISIBLE_FEED_STATES),
    ))
    .limit(1);

  return Boolean(row);
}

// True when `questionId` is already pending in the recipient's RENDERED Feed
// inbox — i.e. a prior direct send or broadcast they can still act on. Used to
// suppress a duplicate send/share.
//
// Scoped to ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES on purpose. The D-1 Stage 5
// feed flip (2026-06-01) pulled `friend_answered` (type-3) OUT of the Feed — it
// is now ambient From-Friends presence, derived per-batch and possibly held as
// an invisible singleton for up to 5 days (see lib/friend-activity.ts). A row
// the recipient can't even see must NOT block a deliberate send, so a
// `friend_answered` row is intentionally excluded here. Before the flip this
// guard had no sourceType filter, which silently became over-broad once type-3
// stopped rendering — a question you'd answered (auto-fanned to your followers)
// could no longer be hand-sent to any of them. (`userAnsweredQuestionCorrectly`
// still independently blocks sending something the recipient already got right.)
export async function userHasQuestionInBlockingFeed(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, userId),
      eq(feedItems.questionId, questionId),
      inArray(feedItems.state, BLOCKING_FEED_STATES),
      inArray(feedItems.sourceType, [...ALWAYS_VISIBLE_MAIN_FEED_SOURCE_TYPES]),
    ))
    .limit(1);

  return Boolean(row);
}

export async function getViewerAnswerStatusForQuestions(
  userId: string,
  questionIds: string[],
): Promise<Map<string, ViewerAnswerStatus>> {
  const result = new Map<string, ViewerAnswerStatus>();
  if (questionIds.length === 0) return result;

  const rows = await db
    .select({
      questionId: masteryEvents.questionId,
      answerState: masteryEvents.answerState,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.answeredByUserId, userId),
      inArray(masteryEvents.questionId, questionIds),
    ));

  for (const row of rows) {
    if (!row.questionId) continue;
    const isCorrect = row.answerState !== null && row.answerState !== 'incorrect';
    const existing = result.get(row.questionId);
    // Any correct answer wins; otherwise stay with the first incorrect we see.
    if (isCorrect) {
      result.set(row.questionId, { result: 'correct' });
    } else if (!existing) {
      result.set(row.questionId, { result: 'incorrect' });
    }
  }

  return result;
}

// Reveal a single feed item's canonical answer to its recipient, for the
// dismissed-card "back of the card" view. The inner join on `questions` means a
// missing, foreign, or question-less feed item yields no row → null. Scoping to
// the recipient is the only authorization needed: they already received this
// question in their feed. Intentionally NOT gated on feedItem.state — a
// dismissed item must still reveal its answer.
export async function getFeedItemAnswerForRecipient(
  feedItemId: string,
  recipientUserId: string,
): Promise<{ answer: string | null; questionText: string } | null> {
  const [row] = await db
    .select({
      answer: questions.answerText,
      questionText: questions.questionText,
    })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(and(
      eq(feedItems.id, feedItemId),
      eq(feedItems.recipientUserId, recipientUserId),
      // Safety hard-block: never reveal a blocked question's text/answer, even
      // to a direct recipient holding a stale feed item id.
      ne(questions.visibility, 'blocked'),
    ))
    .limit(1);

  if (!row) return null;
  return { answer: row.answer ?? null, questionText: row.questionText };
}

export async function userAnsweredQuestionCorrectly(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.questionId, questionId),
      eq(masteryEvents.answeredByUserId, userId),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      ne(masteryEvents.answerState, 'incorrect'),
      sql`${masteryEvents.awardedPoints} > 0`,
    ))
    .limit(1);

  return Boolean(row);
}
