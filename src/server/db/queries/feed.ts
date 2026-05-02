import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, feedItems, masteryEvents, users } from '@/server/db';

export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
export type FeedItemState = 'active' | 'answered' | 'skipped' | 'dismissed' | 'rolled_off' | 'played';
export type CollapsedFeedItem = FeedItem & {
  thumbsUpCount?: number;
  additionalEndorsers?: Array<{ userId: string; displayName: string }>;
};

const VISIBLE_FEED_STATES = ['active', 'skipped'] as const;
const BLOCKING_FEED_STATES = ['active', 'skipped', 'dismissed'] as const;

function thumbsupCollapseKey(item: FeedItem): string | null {
  if (item.sourceType !== 'thumbs_upped' || !item.questionId) return null;
  return item.questionId;
}

async function collapseThumbsUpItems(items: FeedItem[]): Promise<CollapsedFeedItem[]> {
  const groups = new Map<string, FeedItem[]>();
  items.forEach((item) => {
    const key = thumbsupCollapseKey(item);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  const collapsedById = new Map<string, CollapsedFeedItem>();
  const hiddenIds = new Set<string>();
  const additionalUserIds = new Set<string>();

  groups.forEach((group) => {
    if (group.length <= 1) return;
    const [mostRecent, ...older] = [...group].sort((a, b) => b.sourceEventAt.getTime() - a.sourceEventAt.getTime());
    older.forEach((item) => {
      hiddenIds.add(item.id);
      additionalUserIds.add(item.sourceUserId);
    });
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
    const nameById = new Map(userRows.map((user) => [user.id, user.displayName?.trim() || 'A friend']));
    collapsedById.forEach((item) => {
      item.additionalEndorsers = item.additionalEndorsers?.map((endorser) => ({
        ...endorser,
        displayName: nameById.get(endorser.userId) ?? 'A friend',
      }));
    });
  }

  return items
    .filter((item) => !hiddenIds.has(item.id))
    .map((item) => collapsedById.get(item.id) ?? item);
}

export async function getFeedForUser(userId: string): Promise<CollapsedFeedItem[]> {
  const [pinned, nonPinned] = await Promise.all([
    db
      .select()
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.isPinned, true),
        inArray(feedItems.state, VISIBLE_FEED_STATES),
      ))
      .orderBy(desc(feedItems.sourceEventAt)),
    db
      .select()
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.isPinned, false),
        inArray(feedItems.state, VISIBLE_FEED_STATES),
      ))
      .orderBy(desc(feedItems.sourceEventAt))
      .limit(25),
  ]);

  return collapseThumbsUpItems([...pinned, ...nonPinned]);
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
