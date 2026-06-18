/**
 * B-VIA-ATTRIBUTION-01 — per-question "Via [friend]" answerer attribution.
 *
 * A batched, follow-gated, recency-ordered read of the friends (people the
 * viewer follows) who answered each on-feed question CORRECTLY. This is a
 * per-question *side-channel* attached to questions that are already on the
 * feed for other reasons (direct sends, broadcasts, likes) — it is NOT a card
 * and must never touch the card-visibility whitelist in `feed/visibility.ts`.
 *
 * Recency-only by design (the shipped half): the lead is the most-recent
 * friend-answerer, so the copy makes no relevance/closeness claim. A relevance
 * score is a separate, deferred project.
 *
 * The DB read mirrors `getLatelyMilestones`/`getFriendActivity` in
 * `lately.ts:197-242,341-376` — the same `friend_answered` + approved-follow
 * inner join, scoped to a batch of questionIds instead of a time window. The
 * pure `groupAnswerersByQuestion` is DB-free so the grouping/ordering/gating
 * invariants are unit-testable without a database.
 */

import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import { db, feedItems, follows, users } from '@/server/db';
import { SOCIAL_FEED_SOURCE_TYPE, notBlockedForViewer } from '@/server/feed/visibility';

/** A raw answerer row as read from the DB (one per friend_answered event). */
export type ViaAnswererRow = {
  questionId: string;
  userId: string;
  displayName: string | null;
  answeredAt: Date;
};

/** A resolved answerer, ready for the wire / a FeedPersonLink. */
export type ViaAnswerer = {
  userId: string;
  displayName: string;
  href: string;
  /** ISO-8601; recency-ordering key (most-recent first within a question). */
  answeredAt: string;
};

function profileHref(userId: string): string {
  return `/users/${encodeURIComponent(userId)}`;
}

/**
 * Group raw answerer rows by questionId into recency-ordered attribution sets.
 *
 * Pure and deterministic. Enforces, in this order, the invariants the build's
 * Done-when list calls out:
 *  - self-exclusion: the viewer is never listed in their own "Via" set;
 *  - follow-gating: only `sourceUserId ∈ approvedFollowIds` survive (the DB
 *    join is the authoritative gate; this is defense-in-depth so a future
 *    caller that forgets the join can't leak a non-followed name);
 *  - dedup per (question, friend): a friend who answered twice appears once,
 *    keyed to their MOST-RECENT answer;
 *  - recency order: each set is sorted newest-first, ties broken by userId for
 *    stable output.
 */
export function groupAnswerersByQuestion(
  rows: ViaAnswererRow[],
  opts: { viewerUserId: string; approvedFollowIds: Set<string> },
): Map<string, ViaAnswerer[]> {
  const { viewerUserId, approvedFollowIds } = opts;

  // questionId -> (userId -> best-so-far row)
  const byQuestion = new Map<string, Map<string, ViaAnswererRow>>();

  for (const row of rows) {
    if (!row.questionId || !row.userId || !row.answeredAt) continue;
    if (row.userId === viewerUserId) continue; // self-exclusion
    if (!approvedFollowIds.has(row.userId)) continue; // follow-gating

    let perFriend = byQuestion.get(row.questionId);
    if (!perFriend) {
      perFriend = new Map<string, ViaAnswererRow>();
      byQuestion.set(row.questionId, perFriend);
    }
    const existing = perFriend.get(row.userId);
    if (!existing || row.answeredAt.getTime() > existing.answeredAt.getTime()) {
      perFriend.set(row.userId, row);
    }
  }

  const result = new Map<string, ViaAnswerer[]>();
  for (const [questionId, perFriend] of byQuestion) {
    const answerers = [...perFriend.values()]
      .sort((a, b) => {
        const delta = b.answeredAt.getTime() - a.answeredAt.getTime();
        if (delta !== 0) return delta; // newest-first
        return a.userId.localeCompare(b.userId); // stable tiebreak
      })
      .map((row) => ({
        userId: row.userId,
        displayName: row.displayName?.trim() || 'A friend',
        href: profileHref(row.userId),
        answeredAt: row.answeredAt.toISOString(),
      }));
    if (answerers.length > 0) result.set(questionId, answerers);
  }
  return result;
}

/**
 * Batched read of the follow-gated, recency-ordered "Via" answerer set for a
 * page of questions. One query, keyed on the page's questionIds — no N+1.
 *
 * Covered by `FeedItem_questionId_idx` + `FeedItem_recipientUserId_state_idx`.
 * Returns an empty map for an empty questionId batch (no query issued).
 */
export async function getViaAnswerersForQuestions(
  viewerUserId: string,
  questionIds: string[],
): Promise<Map<string, ViaAnswerer[]>> {
  const ids = [...new Set(questionIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      questionId: feedItems.questionId,
      userId: feedItems.sourceUserId,
      displayName: users.displayName,
      answeredAt: feedItems.sourceEventAt,
    })
    .from(feedItems)
    // sourceUserId ∈ {people I follow}: the authoritative follow gate. A
    // friend_answered row from someone the viewer doesn't follow is dropped at
    // the DB (mirrors lately.ts:210-217).
    .innerJoin(
      follows,
      and(
        eq(follows.followeeId, feedItems.sourceUserId),
        eq(follows.followerId, viewerUserId),
        eq(follows.state, 'approved'),
      ),
    )
    .innerJoin(users, eq(users.id, feedItems.sourceUserId))
    .where(
      and(
        eq(feedItems.recipientUserId, viewerUserId),
        eq(feedItems.sourceType, SOCIAL_FEED_SOURCE_TYPE),
        eq(feedItems.sourceResult, 'correct'),
        isNotNull(feedItems.questionId),
        inArray(feedItems.questionId, ids),
        // Never attribute the viewer to themselves (a self-answered row).
        ne(feedItems.sourceUserId, viewerUserId),
        // Safety hard-block: a blocked question never carries attribution.
        notBlockedForViewer(viewerUserId),
      ),
    )
    .orderBy(desc(feedItems.sourceEventAt))
    .limit(2000);

  const answererRows: ViaAnswererRow[] = [];
  const approvedFollowIds = new Set<string>();
  for (const row of rows) {
    if (!row.questionId || !row.userId || !row.answeredAt) continue;
    // Every joined row is, by construction, an approved follow — collect the
    // set so the pure grouper's follow-gate is satisfied end-to-end.
    approvedFollowIds.add(row.userId);
    answererRows.push({
      questionId: row.questionId,
      userId: row.userId,
      displayName: row.displayName,
      answeredAt: row.answeredAt,
    });
  }

  return groupAnswerersByQuestion(answererRows, {
    viewerUserId,
    approvedFollowIds,
  });
}
