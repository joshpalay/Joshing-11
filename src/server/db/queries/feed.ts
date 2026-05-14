import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { db, feedDismissedDomains, feedItems, masteryEvents, questions, users } from '@/server/db';
import { AUTHORED_SHARED_FEED_SOURCE_TYPE, SOCIAL_FEED_SOURCE_TYPE, isMainFeedSourceVisible } from '@/server/feed/visibility';
import { pgErrorCode } from '@/server/db/pg-error';

export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
export type FeedItemState = 'active' | 'answered' | 'skipped' | 'dismissed' | 'rolled_off' | 'played';

export type FriendResult = { userId: string; displayName: string; result: 'correct' | 'incorrect' | null };

export type CollapsedFeedItem = FeedItem & {
  // friend_answered collapse: all friends who answered this question
  friendResults?: FriendResult[];
  // legacy thumbs_upped collapse
  thumbsUpCount?: number;
  additionalEndorsers?: Array<{ userId: string; displayName: string }>;
};

const VISIBLE_FEED_STATES = ['active', 'skipped'] as const;
const BLOCKING_FEED_STATES = ['active', 'skipped', 'dismissed'] as const;

const visibleFeedSourcePredicate = or(
  eq(feedItems.sourceType, AUTHORED_SHARED_FEED_SOURCE_TYPE),
  and(
    eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
    eq(feedItems.sourceResult, 'correct'),
  ),
);

function isVisibleFriendAnsweredSource(sourceType: string, sourceResult: string | null): boolean {
  return sourceType === SOCIAL_FEED_SOURCE_TYPE && sourceResult === 'correct';
}

async function collapseFriendAnsweredItems(items: FeedItem[]): Promise<CollapsedFeedItem[]> {
  const friendAnsweredByQuestion = new Map<string, FeedItem[]>();

  for (const item of items) {
    if (isVisibleFriendAnsweredSource(item.sourceType, item.sourceResult) && item.questionId) {
      const group = friendAnsweredByQuestion.get(item.questionId) ?? [];
      group.push(item);
      friendAnsweredByQuestion.set(item.questionId, group);
    }
  }

  // Collect all source user IDs we need display names for
  const sourceUserIds = new Set<string>();
  friendAnsweredByQuestion.forEach((group) => {
    group.forEach((item) => sourceUserIds.add(item.sourceUserId));
  });

  const nameById = new Map<string, string>();
  if (sourceUserIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...sourceUserIds]));
    for (const row of userRows) {
      nameById.set(row.id, row.displayName?.trim() || 'A friend');
    }
  }

  // Build the hidden IDs set and the representative items
  const hiddenIds = new Set<string>();
  const collapsedById = new Map<string, CollapsedFeedItem>();

  friendAnsweredByQuestion.forEach((group) => {
    if (group.length <= 1) return;
    const sorted = [...group].sort((a, b) => b.sourceEventAt.getTime() - a.sourceEventAt.getTime());
    const [mostRecent, ...older] = sorted;
    older.forEach((item) => hiddenIds.add(item.id));

    const friendResults: FriendResult[] = sorted.map((item) => ({
      userId: item.sourceUserId,
      displayName: nameById.get(item.sourceUserId) ?? 'A friend',
      result: (item.sourceResult as 'correct' | 'incorrect' | null) ?? null,
    }));

    collapsedById.set(mostRecent.id, { ...mostRecent, friendResults });
  });

  return items
    .filter((item) => !hiddenIds.has(item.id))
    .map((item) => {
      if (collapsedById.has(item.id)) return collapsedById.get(item.id)!;
      // Single friend_answered item — wrap in friendResults for consistent display
      if (isVisibleFriendAnsweredSource(item.sourceType, item.sourceResult)) {
        return {
          ...item,
          friendResults: [{
            userId: item.sourceUserId,
            displayName: nameById.get(item.sourceUserId) ?? 'A friend',
            result: (item.sourceResult as 'correct' | 'incorrect' | null) ?? null,
          }],
        } satisfies CollapsedFeedItem;
      }
      return item;
    });
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

export async function getDismissedDomains(userId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ canonicalSubcategory: feedDismissedDomains.canonicalSubcategory })
      .from(feedDismissedDomains)
      .where(and(
        eq(feedDismissedDomains.userId, userId),
        isNull(feedDismissedDomains.reinstatedAt),
      ));
    return rows.map((r) => r.canonicalSubcategory);
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return []; // FeedDismissedDomain table not yet migrated
    throw error;
  }
}

export async function dismissDomain(userId: string, canonicalSubcategory: string): Promise<void> {
  // Check if already dismissed
  const [existing] = await db
    .select({ id: feedDismissedDomains.id })
    .from(feedDismissedDomains)
    .where(and(
      eq(feedDismissedDomains.userId, userId),
      eq(feedDismissedDomains.canonicalSubcategory, canonicalSubcategory),
      isNull(feedDismissedDomains.reinstatedAt),
    ))
    .limit(1);

  if (existing) return;

  await db.insert(feedDismissedDomains).values({ userId, canonicalSubcategory });

  // Soft-delete all active feed items in this domain for this user
  const domainItems = await db
    .select({ feedItemId: feedItems.id })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(and(
      eq(feedItems.recipientUserId, userId),
      inArray(feedItems.state, VISIBLE_FEED_STATES),
      eq(questions.canonicalSubcategory, canonicalSubcategory),
    ));

  if (domainItems.length > 0) {
    await db
      .update(feedItems)
      .set({ state: 'dismissed' })
      .where(inArray(feedItems.id, domainItems.map((r) => r.feedItemId)));
  }
}

export async function reinstateDomain(userId: string, canonicalSubcategory: string): Promise<void> {
  await db
    .update(feedDismissedDomains)
    .set({ reinstatedAt: new Date() })
    .where(and(
      eq(feedDismissedDomains.userId, userId),
      eq(feedDismissedDomains.canonicalSubcategory, canonicalSubcategory),
      isNull(feedDismissedDomains.reinstatedAt),
    ));
}

export type FeedCursor = {
  sourceEventAt: number;
  id: string;
};

export type FeedPageOptions = {
  limit?: number;
  cursor?: string;
};

export type FeedPage = {
  items: CollapsedFeedItem[];
  pinnedItems: CollapsedFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export const DEFAULT_FEED_LIMIT = 20;
export const MAX_FEED_LIMIT = 50;
const FEED_FETCH_BATCH_SIZE = 100;

function clampFeedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_FEED_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_FEED_LIMIT), 1), MAX_FEED_LIMIT);
}

function encodeFeedCursor(item: FeedItem): string {
  return Buffer.from(JSON.stringify({
    sourceEventAt: item.sourceEventAt.getTime(),
    id: item.id,
  }), 'utf8').toString('base64url');
}

function decodeFeedCursor(cursor: string | undefined): FeedCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      sourceEventAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.sourceEventAt !== 'number' || typeof parsed.id !== 'string') return null;
    return { sourceEventAt: parsed.sourceEventAt, id: parsed.id };
  } catch {
    return null;
  }
}

function feedCursorPredicate(cursor: FeedCursor | null) {
  if (!cursor) return undefined;
  const cursorDate = new Date(cursor.sourceEventAt);
  if (Number.isNaN(cursorDate.getTime())) return undefined;

  return or(
    lt(feedItems.sourceEventAt, cursorDate),
    and(eq(feedItems.sourceEventAt, cursorDate), lt(feedItems.id, cursor.id)),
  );
}

function compareFeedItems(a: FeedItem, b: FeedItem): number {
  return b.sourceEventAt.getTime() - a.sourceEventAt.getTime() || b.id.localeCompare(a.id);
}

async function visibleQuestionMetadata(items: FeedItem[]) {
  const questionIds = [...new Set(items.map((item) => item.questionId).filter((id): id is string => Boolean(id)))];
  const rows = questionIds.length > 0
    ? await db
        .select({ id: questions.id, canonicalSubcategory: questions.canonicalSubcategory, visibility: questions.visibility, deletedAt: questions.deletedAt })
        .from(questions)
        .where(inArray(questions.id, questionIds))
    : [];

  return {
    domainByQuestionId: new Map(rows.map((r) => [r.id, r.canonicalSubcategory])),
    visibleQuestionIds: new Set(rows.filter((r) => r.visibility === 'public' && !r.deletedAt).map((r) => r.id)),
  };
}

async function collapseFeedItems(items: FeedItem[]): Promise<CollapsedFeedItem[]> {
  const afterThumbsUp = await collapseThumbsUpItems(items);
  return collapseFriendAnsweredItems(afterThumbsUp);
}

export async function getFeedForUser(userId: string, options: FeedPageOptions = {}): Promise<FeedPage> {
  const limit = clampFeedLimit(options.limit);
  const cursor = decodeFeedCursor(options.cursor);
  const dismissedDomains = await getDismissedDomains(userId);
  const dismissedSet = new Set(dismissedDomains);
  const includePinnedItems = !cursor;

  const baseNonPinnedPredicate = and(
    eq(feedItems.recipientUserId, userId),
    eq(feedItems.isPinned, false),
    visibleFeedSourcePredicate,
    inArray(feedItems.state, VISIBLE_FEED_STATES),
    feedCursorPredicate(cursor),
  );

  const [pinnedRaw, nonPinnedRaw] = await Promise.all([
    includePinnedItems
      ? db
          .select()
          .from(feedItems)
          .where(and(
            eq(feedItems.recipientUserId, userId),
            eq(feedItems.isPinned, true),
            visibleFeedSourcePredicate,
            inArray(feedItems.state, VISIBLE_FEED_STATES),
          ))
          .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
      : Promise.resolve([]),
    db
      .select()
      .from(feedItems)
      .where(baseNonPinnedPredicate)
      .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
      .limit(FEED_FETCH_BATCH_SIZE),
  ]);

  const { domainByQuestionId, visibleQuestionIds } = await visibleQuestionMetadata([...pinnedRaw, ...nonPinnedRaw]);

  const filterItem = (item: FeedItem) => {
    if (!isMainFeedSourceVisible(item.sourceType, item.sourceResult)) return false;
    if (!item.questionId || !visibleQuestionIds.has(item.questionId)) return false;
    if (dismissedSet.size === 0) return true;
    const domain = domainByQuestionId.get(item.questionId);
    return !domain || !dismissedSet.has(domain);
  };

  const pinnedItems = includePinnedItems ? await collapseFeedItems(pinnedRaw.filter(filterItem).sort(compareFeedItems)) : [];
  const visibleNonPinned = nonPinnedRaw.filter(filterItem).sort(compareFeedItems);
  const collapsedNonPinned = await collapseFeedItems(visibleNonPinned);
  const items = collapsedNonPinned.slice(0, limit);
  const hasMore = collapsedNonPinned.length > limit || nonPinnedRaw.length === FEED_FETCH_BATCH_SIZE;
  const cursorItem = items[items.length - 1] ?? nonPinnedRaw[nonPinnedRaw.length - 1];

  return {
    items,
    pinnedItems,
    nextCursor: hasMore && cursorItem ? encodeFeedCursor(cursorItem) : null,
    hasMore,
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
      inArray(feedItems.state, VISIBLE_FEED_STATES),
    ))
    .orderBy(desc(feedItems.sourceEventAt))
    .offset(25);

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

export async function userHasQuestionInBlockingFeed(userId: string, questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(
      eq(feedItems.recipientUserId, userId),
      eq(feedItems.questionId, questionId),
      inArray(feedItems.state, BLOCKING_FEED_STATES),
    ))
    .limit(1);

  return Boolean(row);
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
