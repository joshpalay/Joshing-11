import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedDismissedDomains, feedItems, questions } from '@/server/db';
import { areFriends } from '@/server/db/queries/friends';
import { isMainFeedSourceVisible } from '@/server/feed/visibility';

export const dynamic = 'force-dynamic';

type FeedDebugDiagnosis =
  | 'no_feed_item_for_viewer'
  | 'not_friends'
  | 'domain_dismissed'
  | 'question_deleted'
  | 'question_not_public'
  | 'feed_item_state_hidden'
  | 'source_type_filtered'
  | 'should_be_visible';

const VISIBLE_FEED_STATES = new Set(['active', 'skipped']);

function isFeedDebugEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.FEED_DEBUG_ENABLED === 'true';
}

function diagnose(input: {
  question: typeof questions.$inferSelect | null;
  feedItem: typeof feedItems.$inferSelect | null;
  friendshipStatus: string | null;
  domainDismissed: boolean;
  viewerUserId: string;
}): FeedDebugDiagnosis {
  const { question, feedItem, friendshipStatus, domainDismissed, viewerUserId } = input;

  if (!feedItem) return 'no_feed_item_for_viewer';

  const questionCreatorId = question?.creatorId ?? null;
  if (questionCreatorId && questionCreatorId !== viewerUserId && friendshipStatus !== 'active') return 'not_friends';
  if (domainDismissed) return 'domain_dismissed';
  if (question?.deletedAt) return 'question_deleted';
  if (question && question.visibility !== 'public') return 'question_not_public';
  if (!VISIBLE_FEED_STATES.has(feedItem.state)) return 'feed_item_state_hidden';
  if (!isMainFeedSourceVisible(feedItem.sourceType, feedItem.sourceResult)) return 'source_type_filtered';

  return 'should_be_visible';
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!isFeedDebugEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const questionId = request.nextUrl.searchParams.get('question_id')?.trim();
  if (!questionId) return NextResponse.json({ error: 'question_id_required' }, { status: 400 });

  const [question, feedItem] = await Promise.all([
    db.select().from(questions).where(eq(questions.id, questionId)).limit(1).then((rows) => rows[0] ?? null),
    db
      .select()
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, session.userId),
        eq(feedItems.questionId, questionId),
      ))
      .orderBy(desc(feedItems.sourceEventAt), desc(feedItems.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const questionCreatorId = question?.creatorId ?? null;
  const [isMutual, dismissedDomain] = await Promise.all([
    questionCreatorId && questionCreatorId !== session.userId
      ? areFriends(session.userId, questionCreatorId)
      : Promise.resolve(false),
    question?.canonicalSubcategory
      ? db
        .select({ id: feedDismissedDomains.id })
        .from(feedDismissedDomains)
        .where(and(
          eq(feedDismissedDomains.userId, session.userId),
          eq(feedDismissedDomains.canonicalSubcategory, question.canonicalSubcategory),
          isNull(feedDismissedDomains.reinstatedAt),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const friendshipStatus = isMutual ? 'active' : null;
  const domainDismissed = Boolean(dismissedDomain);

  return NextResponse.json({
    viewerUserId: session.userId,
    questionId,
    questionExists: Boolean(question),
    questionVisibility: question?.visibility ?? null,
    questionDeletedAt: question?.deletedAt ?? null,
    questionCreatorId,
    friendshipStatus,
    feedItemExists: Boolean(feedItem),
    feedItemState: feedItem?.state ?? null,
    feedItemSourceType: feedItem?.sourceType ?? null,
    feedItemSourceResult: feedItem?.sourceResult ?? null,
    domainDismissed,
    diagnosis: diagnose({
      question,
      feedItem,
      friendshipStatus,
      domainDismissed,
      viewerUserId: session.userId,
    }),
  });
}
