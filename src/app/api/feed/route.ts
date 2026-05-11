import { and, count, eq, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, feedItems, friendships, joshingGames, questions, users } from '@/server/db';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { getDismissedDomains, getFeedForUser, type CollapsedFeedItem } from '@/server/db/queries/feed';

export const dynamic = 'force-dynamic';

function displayName(name: string | null, fallback = 'A friend') {
  return name?.trim() || fallback;
}

function domainPill(question: typeof questions.$inferSelect | undefined) {
  return question?.canonicalSubcategory || question?.broadCategory || question?.category || 'General';
}

function resultVerb(result: string | null, name: string): string {
  return result === 'correct' ? `${name} got this right` : `${name} couldn't get this`;
}

function friendAnsweredAttribution(item: CollapsedFeedItem, userById: Map<string, { displayName: string | null }>, domain: string): string {
  const results = item.friendResults;
  if (!results || results.length === 0) {
    const name = displayName(userById.get(item.sourceUserId)?.displayName ?? null);
    const verb = resultVerb(item.sourceResult ?? null, name);
    return `${verb} — ${domain}`;
  }

  if (results.length === 1) {
    const { displayName: dn, result } = results[0];
    return `${resultVerb(result, dn)} — ${domain}`;
  }

  // Multiple friends: "Robyn got this right · Greg couldn't get it — Domain"
  const parts = results
    .slice(0, 3) // cap at 3 names for readability
    .map(({ displayName: dn, result }) => (result === 'correct' ? `${dn} got this right` : `${dn} couldn't get it`));
  return `${parts.join(' · ')} — ${domain}`;
}

function thumbsupAttribution(sourceName: string, count: number | undefined) {
  if (!count || count <= 1) return `${sourceName} thumbed up`;
  if (count === 2) return `${sourceName} + 1 other thumbed up`;
  return `${sourceName} + ${count - 1} others thumbed up`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [rawFeed, friendCount, dismissedDomains, totalItemCount, preFilterActiveCount] = await Promise.all([
    getFeedForUser(session.userId),
    db
      .select({ value: count() })
      .from(friendships)
      .where(and(
        eq(friendships.status, 'active'),
        or(eq(friendships.userAId, session.userId), eq(friendships.userBId, session.userId)),
      ))
      .then((rows) => rows[0]?.value ?? 0),
    getDismissedDomains(session.userId),
    db
      .select({ value: count() })
      .from(feedItems)
      .where(eq(feedItems.recipientUserId, session.userId))
      .then((rows) => rows[0]?.value ?? 0),
    // Items in active/skipped state before domain filtering — distinguishes "focused" from "caught up"
    db
      .select({ value: count() })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, session.userId),
        inArray(feedItems.state, ['active', 'skipped']),
      ))
      .then((rows) => rows[0]?.value ?? 0),
  ]);

  const feed = rawFeed;
  const questionIds = feed.map((item) => item.questionId).filter((id): id is string => Boolean(id));
  const sourceUserIds = [...new Set(feed.map((item) => item.sourceUserId))];
  const gameIds = feed.map((item) => item.joshingGameId).filter((id): id is string => Boolean(id));

  const [questionRows, sourceRows, gameRows, bankedById] = await Promise.all([
    questionIds.length
      ? db.select().from(questions).where(inArray(questions.id, questionIds))
      : Promise.resolve([]),
    sourceUserIds.length
      ? db.select().from(users).where(inArray(users.id, sourceUserIds))
      : Promise.resolve([]),
    gameIds.length
      ? db.select().from(joshingGames).where(inArray(joshingGames.id, gameIds))
      : Promise.resolve([]),
    checkBankedQuestions(session.userId, questionIds),
  ]);

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const userById = new Map(sourceRows.map((u) => [u.id, u]));
  const gameById = new Map(gameRows.map((g) => [g.id, g]));

  return NextResponse.json({
    viewer_user_id: session.userId,
    meta: {
      has_friends: friendCount > 0,
      has_dismissed_domains: dismissedDomains.length > 0,
      total_item_count: totalItemCount,
      active_item_count: feed.length,
      pre_filter_active_count: preFilterActiveCount,
    },
    items: feed.map((item) => {
      const question = item.questionId ? questionById.get(item.questionId) : undefined;
      const sourceUser = userById.get(item.sourceUserId);
      const sourceName = displayName(sourceUser?.displayName ?? null);
      const game = item.joshingGameId ? gameById.get(item.joshingGameId) : undefined;
      const domain = domainPill(question);

      let source_attribution: string;
      if (item.sourceType === 'direct_sent') {
        source_attribution = `${sourceName} sent this to you`;
      } else if (item.sourceType === 'friend_answered') {
        source_attribution = friendAnsweredAttribution(item, userById, domain);
      } else if (item.sourceType === 'authored_shared') {
        source_attribution = `${sourceName} wrote this`;
      } else if (item.sourceType === 'joshing_game') {
        source_attribution = `${sourceName} sent you a Joshing Game`;
      } else {
        source_attribution = thumbsupAttribution(sourceName, item.thumbsUpCount);
      }

      return {
        id: item.id,
        kind: item.sourceType === 'joshing_game' ? 'joshing_game' : 'question',
        question_id: item.questionId,
        joshing_game_id: item.joshingGameId,
        source_type: item.sourceType,
        source_user_id: item.sourceUserId,
        source_result: item.sourceResult ?? null,
        source_friend_display_name: sourceName,
        source_attribution,
        friend_results: item.friendResults ?? null,
        source_event_at: item.sourceEventAt,
        personal_message: item.personalMessage,
        state: item.state,
        is_pinned: item.isPinned,
        question_text: question?.questionText ?? null,
        verified: question?.verified ?? true,
        is_in_bank: item.questionId ? Boolean(bankedById[item.questionId]) : false,
        explanation: question?.explainerBrief ?? question?.factualExplanation ?? null,
        domain_pill: domain,
        game_title: game?.title ?? null,
        difficulty: question?.calibratedDifficulty ?? question?.llmDifficulty ?? question?.difficultyEstimate ?? null,
      };
    }),
  });
}
