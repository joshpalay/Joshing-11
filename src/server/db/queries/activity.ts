import { and, count, desc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';

import {
  activityItems,
  db,
  feedItems,
  follows,
  friendships,
  gradeDisputes,
  joshingGameQuestions,
  joshingGameRecipients,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  playerMastery,
  questionReactions,
  questions,
  users,
} from '@/server/db';
import { getCannedReaction } from '@/lib/reactions';
import { resolveAuthorDisplay } from '@/lib/questions-types';
import { HOME_TOP3_ELIGIBLE_TYPES, type ActivityItemType } from '@/server/activity/write-activity';
import { pgErrorCode, pgErrorMessage } from '@/server/db/pg-error';
import type { MasteryTier } from '@/types/db';

type ActivityItemRow = typeof activityItems.$inferSelect;
type GameViewerStatus = 'not_started' | 'in_progress' | 'complete';

export type ActivityItemView = Pick<
  ActivityItemRow,
  'id' | 'userId' | 'actorUserId' | 'referenceId' | 'referenceType' | 'read' | 'createdAt'
> & {
  type: ActivityItemType;
  actor: { displayName: string } | null;
  reference: {
    game?: {
      title: string;
      viewerStatus: 'not_started' | 'in_progress' | 'complete';
      viewerScore: number;
      totalQuestions: number;
      completedCount: number;
      totalRecipients: number;
    };
    masteryEvent?: {
      domain: string;
      tier: MasteryTier | null;
    };
    reaction?: {
      id: string;
      reactionLabel: string;
      reactionEmoji: string;
      customMessage: string | null;
      repliedAt: Date | null;
      // The reacted-to question, surfaced so the row can expand to reveal it and
      // offer "send onward" (D-FEED-GROUP3-01 §4). domain + author resolve the
      // honest-authorship reveal: a house/LLM question must never read as if a
      // person wrote it.
      questionId: string;
      questionText: string;
      domain: string | null;
      authorName: string | null;
      authorIsHouse: boolean;
      // §8.22 wrong-answer text visibility: populated only when the answerer
      // explicitly opted in (includeSubmittedAnswer=true on a wrong-answer
      // reaction). Null in every other case.
      submittedAnswer: string | null;
    };
    directQuestion?: {
      feedItemId: string;
      questionId: string;
      questionText: string;
      personalMessage: string | null;
      category: string | null;
    };
    curatedQuestion?: {
      questionText: string;
      // domain + author for the expand-to-send-onward reveal (D-FEED-GROUP3-01
      // §4). The question id is the activity's referenceId.
      domain: string | null;
      authorName: string | null;
      authorIsHouse: boolean;
    };
    friendAnsweredQuestion?: {
      domain: string | null;
      questionText: string | null;
      result: 'correct' | 'incorrect';
      // Honest authorship for the expanded "your question" reveal — a forwarded
      // house/LLM question must not render as if the viewer wrote it.
      authorName: string | null;
      authorIsHouse: boolean;
    };
    // D-2 niche-match discovery. Hydrated for both new types
    // (niche_match_answered_your_question / niche_match_you_answered). Reuses
    // referenceType: 'question' + referenceId: questionId. The result is always
    // 'correct' by construction (the write only fires on a correct answer), so
    // unlike friendAnsweredQuestion there is no got-it/couldn't framing — the
    // domain is the discovery hook.
    nicheMatch?: {
      domain: string | null;
      questionText: string | null;
    };
    authoredSharedQuestion?: {
      domain: string;
      recipientCount: number;
    };
    declaredPromoted?: {
      domain: string;
      questionText: string;
    };
    friendshipRequest?: {
      id: string;
      status: string;
      requestedByUserId: string;
      suggestedInterests: string[];
    };
    gradeDispute?: {
      id: string;
      questionText: string;
      canonicalAnswer: string;
      // §8.22 dispute path: the answerer initiated the dispute, which is
      // the consent gate that exposes their literal text to the author.
      submittedAnswer: string;
      status: string;
      reviewDecision: string | null;
      reviewReason: string | null;
      acceptedAlternative: string | null;
    };
  };
};

function activityCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  return cutoff;
}

function displayName(value: string | null, fallback = 'A friend'): string {
  return value?.trim() || fallback;
}

function isActivityType(value: string): value is ActivityItemType {
  return [
    'received_joshing_game',
    'joshing_game_result',
    'joshing_game_progress',
    'friend_mastery',
    'ceremony_ready',
    'friend_request',
    'friend_request_accepted',
    'follow',
    'follow_request',
    'follow_approved',
    'follow_mutual',
    'invited_friend_played_first_five',
    'received_direct_question',
    'reaction_received',
    'question_curated',
    'friend_answered_your_question',
    'authored_question_shared',
    'declared_promoted',
    'grade_dispute_filed',
    'niche_match_answered_your_question',
    'niche_match_you_answered',
  ].includes(value);
}


function parseFriendshipRequestInterests(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const interests = (value as { suggestedInterests?: unknown }).suggestedInterests;
  if (!Array.isArray(interests)) return [];

  return interests
    .filter((interest): interest is string => typeof interest === 'string' && interest.trim().length > 0)
    .map((interest) => interest.trim())
    .slice(0, 3);
}

async function hydrateFriendshipRequests(items: ActivityItemRow[]) {
  const result = new Map<string, NonNullable<ActivityItemView['reference']['friendshipRequest']>>();

  // New follow-model rows reference the `follows` table; legacy friend-request
  // rows reference the frozen `friendships` table. Hydrate both into one map
  // keyed by referenceId, normalising follow `state` onto the same `status`
  // shape the activity card already reads ('approved' -> 'active').
  const followIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'follow')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (followIds.length > 0) {
    const followRows = await db
      .select({
        id: follows.id,
        state: follows.state,
        followerId: follows.followerId,
        requestContext: follows.requestContext,
      })
      .from(follows)
      .where(inArray(follows.id, followIds));
    for (const row of followRows) {
      result.set(row.id, {
        id: row.id,
        status: row.state === 'approved' ? 'active' : 'pending',
        requestedByUserId: row.followerId,
        suggestedInterests: parseFriendshipRequestInterests(row.requestContext),
      });
    }
  }

  const friendshipIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'friendship')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (friendshipIds.length > 0) {
    const rows = await db
      .select({
        id: friendships.id,
        status: friendships.status,
        requestedByUserId: friendships.requestedByUserId,
        requestContext: friendships.requestContext,
      })
      .from(friendships)
      .where(inArray(friendships.id, friendshipIds));
    for (const row of rows) {
      result.set(row.id, {
        id: row.id,
        status: row.status,
        requestedByUserId: row.requestedByUserId,
        suggestedInterests: parseFriendshipRequestInterests(row.requestContext),
      });
    }
  }

  return result;
}

async function hydrateActors(items: ActivityItemRow[]) {
  const actorIds = [...new Set(items.map((item) => item.actorUserId).filter((id): id is string => Boolean(id)))];
  if (actorIds.length === 0) return new Map<string, { displayName: string }>();

  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, actorIds));

  return new Map(rows.map((row) => [row.id, { displayName: displayName(row.displayName) }]));
}

async function hydrateGames(items: ActivityItemRow[], userId: string) {
  const gameIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'joshing_game')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (gameIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['game']>>();
  }

  const [gameRows, questionRows, recipientRows, responseRows] = await Promise.all([
    db
      .select({ id: joshingGames.id, title: joshingGames.title })
      .from(joshingGames)
      .where(inArray(joshingGames.id, gameIds)),
    db
      .select({ gameId: joshingGameQuestions.gameId, questionId: joshingGameQuestions.questionId })
      .from(joshingGameQuestions)
      .where(inArray(joshingGameQuestions.gameId, gameIds)),
    db
      .select({ gameId: joshingGameRecipients.gameId, userId: joshingGameRecipients.userId })
      .from(joshingGameRecipients)
      .where(inArray(joshingGameRecipients.gameId, gameIds)),
    db
      .select({
        gameId: joshingGameResponses.gameId,
        questionId: joshingGameResponses.questionId,
        userId: joshingGameResponses.userId,
        isCorrect: joshingGameResponses.isCorrect,
      })
      .from(joshingGameResponses)
      .where(inArray(joshingGameResponses.gameId, gameIds)),
  ]);

  const questionsByGame = new Map<string, Set<string>>();
  for (const row of questionRows) {
    const existing = questionsByGame.get(row.gameId) ?? new Set<string>();
    existing.add(row.questionId);
    questionsByGame.set(row.gameId, existing);
  }

  const recipientsByGame = new Map<string, Set<string>>();
  for (const row of recipientRows) {
    const existing = recipientsByGame.get(row.gameId) ?? new Set<string>();
    existing.add(row.userId);
    recipientsByGame.set(row.gameId, existing);
  }

  const responsesByGameUser = new Map<string, Set<string>>();
  const correctByGameUser = new Map<string, number>();
  for (const row of responseRows) {
    const key = `${row.gameId}:${row.userId}`;
    const existing = responsesByGameUser.get(key) ?? new Set<string>();
    existing.add(row.questionId);
    responsesByGameUser.set(key, existing);
    if (row.isCorrect) correctByGameUser.set(key, (correctByGameUser.get(key) ?? 0) + 1);
  }

  return new Map(
    gameRows.map((game) => {
      const totalQuestions = questionsByGame.get(game.id)?.size ?? 0;
      const recipients = recipientsByGame.get(game.id) ?? new Set<string>();
      const completedCount = [...recipients].filter(
        (recipientId) => totalQuestions > 0 && (responsesByGameUser.get(`${game.id}:${recipientId}`)?.size ?? 0) >= totalQuestions,
      ).length;
      const viewerAnswered = responsesByGameUser.get(`${game.id}:${userId}`)?.size ?? 0;
      const viewerStatus: GameViewerStatus = viewerAnswered === 0
        ? 'not_started'
        : totalQuestions > 0 && viewerAnswered >= totalQuestions
          ? 'complete'
          : 'in_progress';

      return [
        game.id,
        {
          title: game.title,
          viewerStatus,
          viewerScore: correctByGameUser.get(`${game.id}:${userId}`) ?? 0,
          totalQuestions,
          completedCount,
          totalRecipients: recipients.size,
        },
      ];
    }),
  );
}

async function hydrateMasteryEvents(items: ActivityItemRow[]) {
  const masteryEventIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'mastery_event')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (masteryEventIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['masteryEvent']>>();
  }

  const rows = await db
    .select({
      id: masteryEvents.id,
      userId: masteryEvents.userId,
      domain: masteryEvents.canonicalSubcategory,
    })
    .from(masteryEvents)
    .where(inArray(masteryEvents.id, masteryEventIds));

  if (rows.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['masteryEvent']>>();
  }

  // Resolve each mastery event's current tier from PlayerMastery. PlayerMastery
  // has a UNIQUE (user_id, canonical_subcategory), so one row per pair. Fetch
  // every distinct (user, domain) pair these events reference in a single query
  // rather than one round-trip per event (the old N+1 fired up to one query per
  // activity item against PlayerMastery on the home-page render path).
  const pairKey = (userId: string, domain: string) => `${userId} ${domain}`;
  const distinctPairs = new Map<string, { userId: string; domain: string }>();
  for (const row of rows) {
    distinctPairs.set(pairKey(row.userId, row.domain), { userId: row.userId, domain: row.domain });
  }

  const masteryRows = await db
    .select({
      userId: playerMastery.userId,
      domain: playerMastery.canonicalSubcategory,
      tier: playerMastery.tier,
    })
    .from(playerMastery)
    .where(
      or(
        ...[...distinctPairs.values()].map((pair) =>
          and(
            eq(playerMastery.userId, pair.userId),
            eq(playerMastery.canonicalSubcategory, pair.domain),
          ),
        ),
      ),
    );

  const tierByPair = new Map(masteryRows.map((m) => [pairKey(m.userId, m.domain), m.tier]));

  return new Map(
    rows.map(
      (row) =>
        [row.id, { domain: row.domain, tier: tierByPair.get(pairKey(row.userId, row.domain)) ?? null }] as const,
    ),
  );
}

async function hydrateReactions(items: ActivityItemRow[]) {
  const reactionIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'question_reaction')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (reactionIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['reaction']>>();
  }

  const rows = await db
    .select({
      id: questionReactions.id,
      reactionType: questionReactions.reactionType,
      customMessage: questionReactions.customMessage,
      repliedAt: questionReactions.repliedAt,
      questionText: questions.questionText,
      senderUserId: questionReactions.senderUserId,
      questionId: questionReactions.questionId,
      contextType: questionReactions.contextType,
      contextId: questionReactions.contextId,
      includeSubmittedAnswer: questionReactions.includeSubmittedAnswer,
      // Domain + provenance for the expand-to-send-onward reveal.
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      creatorId: questions.creatorId,
      source: questions.source,
      authorDisplayName: users.displayName,
    })
    .from(questionReactions)
    .innerJoin(questions, eq(questionReactions.questionId, questions.id))
    // creator may be null (house/LLM), so the author join is a left join.
    .leftJoin(users, eq(users.id, questions.creatorId))
    .where(inArray(questionReactions.id, reactionIds));

  // §8.22 opt-in resolution: for any reaction the answerer flagged with
  // includeSubmittedAnswer=true, join the original submitted text from the
  // matching feed item or joshing-game response. The viewer of this activity
  // is the question's author by construction (reaction activities target
  // recipientUserId === author); the opt-in is the consent gate.
  const optedInRows = rows.filter((row) => row.includeSubmittedAnswer);
  const feedRowIds = optedInRows
    .filter((row) => row.contextType === 'feed' && row.contextId)
    .map((row) => row.contextId!);
  const gameKeys = optedInRows
    .filter((row) => row.contextType === 'joshing_game' && row.contextId)
    .map((row) => ({ gameId: row.contextId!, questionId: row.questionId, userId: row.senderUserId }));
  const gameIds = [...new Set(gameKeys.map((key) => key.gameId))];

  const [feedAnswerRows, gameAnswerRows] = await Promise.all([
    feedRowIds.length > 0
      ? db
          .select({ id: feedItems.id, submittedAnswer: feedItems.submittedAnswer })
          .from(feedItems)
          .where(inArray(feedItems.id, feedRowIds))
      : Promise.resolve([] as { id: string; submittedAnswer: string | null }[]),
    gameIds.length > 0
      ? db
          .select({
            gameId: joshingGameResponses.gameId,
            questionId: joshingGameResponses.questionId,
            userId: joshingGameResponses.userId,
            submittedAnswer: joshingGameResponses.submittedAnswer,
          })
          .from(joshingGameResponses)
          .where(inArray(joshingGameResponses.gameId, gameIds))
      : Promise.resolve([] as {
          gameId: string;
          questionId: string;
          userId: string;
          submittedAnswer: string | null;
        }[]),
  ]);

  const feedAnswerById = new Map(feedAnswerRows.map((row) => [row.id, row.submittedAnswer ?? null]));
  const gameAnswerByKey = new Map(
    gameAnswerRows.map((row) => [`${row.gameId}:${row.questionId}:${row.userId}`, row.submittedAnswer ?? null]),
  );

  return new Map(rows.map((row) => {
    const reaction = getCannedReaction(row.reactionType);
    let submittedAnswer: string | null = null;
    if (row.includeSubmittedAnswer) {
      if (row.contextType === 'feed' && row.contextId) {
        submittedAnswer = feedAnswerById.get(row.contextId) ?? null;
      } else if (row.contextType === 'joshing_game' && row.contextId) {
        submittedAnswer = gameAnswerByKey.get(`${row.contextId}:${row.questionId}:${row.senderUserId}`) ?? null;
      }
    }
    const author = resolveAuthorDisplay(row.creatorId, row.source, row.authorDisplayName);
    return [
      row.id,
      {
        id: row.id,
        reactionLabel: reaction?.label ?? row.reactionType,
        reactionEmoji: reaction?.emoji ?? '',
        customMessage: row.customMessage,
        repliedAt: row.repliedAt,
        questionId: row.questionId,
        questionText: row.questionText,
        domain: row.canonicalSubcategory?.trim() || row.broadCategory || row.category || null,
        authorName: author.authorName,
        authorIsHouse: author.authorIsHouse,
        submittedAnswer,
      },
    ] as const;
  }));
}

async function hydrateDirectQuestions(items: ActivityItemRow[]) {
  const feedItemIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'feed_item')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (feedItemIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['directQuestion']>>();
  }

  const rows = await db
    .select({
      feedItemId: feedItems.id,
      questionId: questions.id,
      personalMessage: feedItems.personalMessage,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      category: questions.category,
    })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(inArray(feedItems.id, feedItemIds));

  return new Map(rows.map((row) => [
    row.feedItemId,
    {
      feedItemId: row.feedItemId,
      questionId: row.questionId,
      questionText: row.questionText,
      personalMessage: row.personalMessage,
      category: row.canonicalSubcategory?.trim() || row.category || null,
    },
  ] as const));
}

async function hydrateCuratedQuestions(items: ActivityItemRow[]) {
  const questionIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'question')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (questionIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['curatedQuestion']>>();
  }

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
    })
    .from(questions)
    // creator may be null (house/LLM), so the author join is a left join.
    .leftJoin(users, eq(users.id, questions.creatorId))
    .where(inArray(questions.id, questionIds));

  return new Map(rows.map((row) => {
    const author = resolveAuthorDisplay(row.creatorId, row.source, row.authorDisplayName);
    return [row.id, {
      questionText: row.questionText,
      domain: row.canonicalSubcategory?.trim() || row.broadCategory || row.category || null,
      authorName: author.authorName,
      authorIsHouse: author.authorIsHouse,
    }] as const;
  }));
}

async function hydrateGradeDisputes(items: ActivityItemRow[]) {
  const disputeIds = [
    ...new Set(
      items
        .filter((item) => item.type === 'grade_dispute_filed' && item.referenceType === 'grade_dispute')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (disputeIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['gradeDispute']>>();
  }

  const rows = await db
    .select({
      id: gradeDisputes.id,
      questionText: gradeDisputes.questionText,
      canonicalAnswer: gradeDisputes.canonicalAnswer,
      submittedAnswer: gradeDisputes.submittedAnswer,
      status: gradeDisputes.status,
      reviewDecision: gradeDisputes.reviewDecision,
      reviewReason: gradeDisputes.reviewReason,
      acceptedAlternative: gradeDisputes.acceptedAlternative,
    })
    .from(gradeDisputes)
    .where(inArray(gradeDisputes.id, disputeIds));

  return new Map(rows.map((row) => [
    row.id,
    {
      id: row.id,
      questionText: row.questionText ?? '',
      canonicalAnswer: row.canonicalAnswer,
      submittedAnswer: row.submittedAnswer,
      status: row.status,
      reviewDecision: row.reviewDecision,
      reviewReason: row.reviewReason,
      acceptedAlternative: row.acceptedAlternative,
    } satisfies NonNullable<ActivityItemView['reference']['gradeDispute']>,
  ]));
}

async function hydrateFriendAnsweredQuestions(items: ActivityItemRow[]) {
  const relevant = items.filter(
    (item) => item.type === 'friend_answered_your_question'
      && item.referenceType === 'question'
      && item.referenceId
      && item.actorUserId,
  );
  if (relevant.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['friendAnsweredQuestion']>>();
  }

  const questionIds = [...new Set(relevant.map((item) => item.referenceId!))];
  const actorIds = [...new Set(relevant.map((item) => item.actorUserId!))];

  const [questionRows, masteryRows] = await Promise.all([
    db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        canonicalSubcategory: questions.canonicalSubcategory,
        broadCategory: questions.broadCategory,
        creatorId: questions.creatorId,
        source: questions.source,
        authorDisplayName: users.displayName,
      })
      .from(questions)
      // creator may be null (house/LLM), so the author join is a left join.
      .leftJoin(users, eq(users.id, questions.creatorId))
      .where(inArray(questions.id, questionIds)),
    db
      .select({ userId: masteryEvents.userId, questionId: masteryEvents.questionId })
      .from(masteryEvents)
      .where(and(
        inArray(masteryEvents.userId, actorIds),
        inArray(masteryEvents.questionId, questionIds),
        inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        sql`${masteryEvents.awardedPoints} > 0`,
      )),
  ]);

  const questionById = new Map(questionRows.map((r) => [r.id, r]));
  const correctSet = new Set(masteryRows.map((r) => `${r.userId}:${r.questionId}`));

  return new Map(
    relevant.map((item) => {
      const q = questionById.get(item.referenceId!);
      const author = q
        ? resolveAuthorDisplay(q.creatorId, q.source, q.authorDisplayName)
        : { authorName: null, authorIsHouse: false };
      return [
        item.id,
        {
          domain: q ? (q.canonicalSubcategory ?? q.broadCategory ?? null) : null,
          questionText: q?.questionText ?? null,
          result: correctSet.has(`${item.actorUserId}:${item.referenceId}`) ? 'correct' : 'incorrect',
          authorName: author.authorName,
          authorIsHouse: author.authorIsHouse,
        } satisfies NonNullable<ActivityItemView['reference']['friendAnsweredQuestion']>,
      ];
    }),
  );
}

// D-2 niche-match. A parallel hydrator to hydrateFriendAnsweredQuestions —
// NOT shared, because that one hardcodes its own type filter
// (friend_answered_your_question) and a mastery-event correctness lookup the
// niche types don't need (they only ever fire on a correct answer). Both
// niche types reference the answered question (referenceType 'question'); we
// surface its domain (the discovery hook) and text. Keyed by item.id so each
// row hydrates independently even when two rows point at the same question.
async function hydrateNicheMatchQuestions(items: ActivityItemRow[]) {
  const relevant = items.filter(
    (item) =>
      (item.type === 'niche_match_answered_your_question'
        || item.type === 'niche_match_you_answered')
      && item.referenceType === 'question'
      && item.referenceId,
  );
  if (relevant.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['nicheMatch']>>();
  }

  const questionIds = [...new Set(relevant.map((item) => item.referenceId!))];
  const questionRows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
    })
    .from(questions)
    .where(inArray(questions.id, questionIds));

  const questionById = new Map(questionRows.map((r) => [r.id, r]));

  return new Map(
    relevant.map((item) => {
      const q = questionById.get(item.referenceId!);
      return [
        item.id,
        {
          domain: q ? (q.canonicalSubcategory ?? q.broadCategory ?? null) : null,
          questionText: q?.questionText ?? null,
        } satisfies NonNullable<ActivityItemView['reference']['nicheMatch']>,
      ];
    }),
  );
}

async function hydrateAuthoredSharedQuestions(items: ActivityItemRow[]) {
  const relevant = items.filter(
    (item) => item.type === 'authored_question_shared' && item.referenceType === 'question' && item.referenceId,
  );
  if (relevant.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['authoredSharedQuestion']>>();
  }

  const questionIds = [...new Set(relevant.map((item) => item.referenceId!))];
  const [questionRows, recipientRows] = await Promise.all([
    db
      .select({ id: questions.id, canonicalSubcategory: questions.canonicalSubcategory, broadCategory: questions.broadCategory, category: questions.category })
      .from(questions)
      .where(inArray(questions.id, questionIds)),
    db
      .select({ questionId: feedItems.questionId, value: count() })
      .from(feedItems)
      .where(and(
        inArray(feedItems.questionId, questionIds),
        eq(feedItems.sourceType, 'authored_shared'),
      ))
      .groupBy(feedItems.questionId),
  ]);

  const questionById = new Map(questionRows.map((row) => [row.id, row]));
  const countByQuestionId = new Map(recipientRows.map((row) => [row.questionId, row.value]));

  return new Map(
    relevant.map((item) => {
      const question = questionById.get(item.referenceId!);
      return [item.id, {
        domain: question ? (question.canonicalSubcategory ?? question.broadCategory ?? question.category) : 'General',
        recipientCount: Number(countByQuestionId.get(item.referenceId!) ?? 0),
      }] as const;
    }),
  );
}

async function hydrateDeclaredPromoted(items: ActivityItemRow[]) {
  const relevant = items.filter(
    (item) => item.type === 'declared_promoted' && item.referenceType === 'question' && item.referenceId,
  );
  if (relevant.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['declaredPromoted']>>();
  }

  const questionIds = [...new Set(relevant.map((item) => item.referenceId!))];
  const rows = await db
    .select({ id: questions.id, questionText: questions.questionText, canonicalSubcategory: questions.canonicalSubcategory, broadCategory: questions.broadCategory, category: questions.category })
    .from(questions)
    .where(inArray(questions.id, questionIds));

  const byId = new Map(rows.map((r) => [r.id, r]));
  return new Map(
    relevant.map((item) => {
      const q = byId.get(item.referenceId!);
      return [item.id, {
        domain: q ? (q.canonicalSubcategory ?? q.broadCategory ?? q.category) : '',
        questionText: q?.questionText ?? '',
      }] as const;
    }),
  );
}

async function hydrateActivityRows(
  rows: ActivityItemRow[],
  userId: string,
): Promise<ActivityItemView[]> {
  const [
    actorsById,
    friendshipRequestsById,
    gamesById,
    masteryEventsById,
    reactionsById,
    directQuestionsById,
    curatedQuestionsById,
    friendAnsweredQuestionsById,
    nicheMatchById,
    authoredSharedQuestionsById,
    declaredPromotedById,
    gradeDisputesById,
  ] = await Promise.all([
    hydrateActors(rows),
    hydrateFriendshipRequests(rows),
    hydrateGames(rows, userId),
    hydrateMasteryEvents(rows),
    hydrateReactions(rows),
    hydrateDirectQuestions(rows),
    hydrateCuratedQuestions(rows),
    hydrateFriendAnsweredQuestions(rows),
    hydrateNicheMatchQuestions(rows),
    hydrateAuthoredSharedQuestions(rows),
    hydrateDeclaredPromoted(rows),
    hydrateGradeDisputes(rows),
  ]);

  return rows
    .filter((row): row is ActivityItemRow & { type: ActivityItemType } => isActivityType(row.type))
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type,
      actorUserId: row.actorUserId,
      referenceId: row.referenceId,
      referenceType: row.referenceType,
      read: row.read,
      createdAt: row.createdAt,
      actor: row.actorUserId ? actorsById.get(row.actorUserId) ?? null : null,
      reference: {
        friendshipRequest: (row.referenceType === 'friendship' || row.referenceType === 'follow') && row.referenceId
          ? friendshipRequestsById.get(row.referenceId)
          : undefined,
        game: row.referenceType === 'joshing_game' && row.referenceId
          ? gamesById.get(row.referenceId)
          : undefined,
        masteryEvent: row.referenceType === 'mastery_event' && row.referenceId
          ? masteryEventsById.get(row.referenceId)
          : undefined,
        reaction: row.referenceType === 'question_reaction' && row.referenceId
          ? reactionsById.get(row.referenceId)
          : undefined,
        directQuestion: row.referenceType === 'feed_item' && row.referenceId
          ? directQuestionsById.get(row.referenceId)
          : undefined,
        curatedQuestion: row.referenceType === 'question' && row.referenceId && row.type === 'question_curated'
          ? curatedQuestionsById.get(row.referenceId)
          : undefined,
        friendAnsweredQuestion: row.type === 'friend_answered_your_question'
          ? friendAnsweredQuestionsById.get(row.id)
          : undefined,
        nicheMatch: row.type === 'niche_match_answered_your_question'
          || row.type === 'niche_match_you_answered'
          ? nicheMatchById.get(row.id)
          : undefined,
        authoredSharedQuestion: row.type === 'authored_question_shared'
          ? authoredSharedQuestionsById.get(row.id)
          : undefined,
        declaredPromoted: row.type === 'declared_promoted'
          ? declaredPromotedById.get(row.id)
          : undefined,
        gradeDispute: row.referenceType === 'grade_dispute' && row.referenceId
          ? gradeDisputesById.get(row.referenceId)
          : undefined,
      },
    }));
}

export async function getActivitiesForUser(
  userId: string,
  // The full Lately / `/activities` list scans the default 90-day cutoff; the
  // home edition passes HOME_WINDOW_DAYS to bound the ambient texture path
  // (D-HOME-DASHBOARD-MODEL-01). Undefined keeps the historical 90-day cutoff.
  windowDays?: number,
): Promise<ActivityItemView[]> {
  const cutoff =
    windowDays === undefined
      ? activityCutoff()
      : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, userId),
      isNull(activityItems.deletedAt),
      gt(activityItems.createdAt, cutoff),
    ))
    .orderBy(desc(activityItems.createdAt))
    .limit(100);

  return hydrateActivityRows(rows, userId);
}

export async function getRecentActivityForHome(
  userId: string,
  limit = 3,
): Promise<ActivityItemView[]> {
  const rows = await db
    .select()
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, userId),
      isNull(activityItems.deletedAt),
      gt(activityItems.createdAt, activityCutoff()),
      inArray(activityItems.type, HOME_TOP3_ELIGIBLE_TYPES as readonly string[]),
    ))
    .orderBy(desc(activityItems.createdAt))
    .limit(limit);

  return hydrateActivityRows(rows, userId);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, userId),
      eq(activityItems.read, false),
      ne(activityItems.type, 'reaction_received'),
      isNull(activityItems.deletedAt),
      gt(activityItems.createdAt, activityCutoff()),
    ));

  let reactionCount = 0;
  try {
    const [reactionRow] = await db
      .select({ value: count() })
      .from(questionReactions)
      .where(and(eq(questionReactions.recipientUserId, userId), isNull(questionReactions.repliedAt)));
    reactionCount = reactionRow?.value ?? 0;
  } catch (error) {
    const missingCamelCaseColumn = pgErrorCode(error) === '42703'
      && (pgErrorMessage(error)?.includes('recipientUserId')
        || pgErrorMessage(error)?.includes('repliedAt')
        || pgErrorMessage(error)?.includes('QuestionReaction'));
    if (!missingCamelCaseColumn) throw error;

    const result = await db.execute(sql<{ value: string }>`
      select count(*)::text as value
      from "QuestionReaction"
      where "creator_id" = ${userId} and "creator_responded_at" is null
    `);
    reactionCount = Number(result.rows[0]?.value ?? 0);
  }

  return (row?.value ?? 0) + reactionCount;
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(activityItems)
    .set({ read: true })
    .where(and(eq(activityItems.userId, userId), eq(activityItems.read, false)));
}

export async function markActivityBellOpened(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ lastActivityBellOpenedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * NOTE: No longer wired to the nav bell badge. The badge now counts ONLY
 * pending friend requests (see getIncomingFollowRequestCount in
 * queries/friends.ts, consumed by /api/nav). This "rolled-off-Home activity"
 * count is retained for potential reuse but is not currently rendered anywhere.
 *
 * Original semantics: events that have rolled off Home's top-3 RecentActivity
 * AND fired since the user last opened the bell — "there's value here you can't
 * see from Home." If an event is still visible on Home, the count stays quiet.
 * If the bell has never been opened (NULL), the floor is the activity 90-day
 * cutoff via activityCutoff(). Returns the raw count.
 */
export async function getBellBadgeCount(userId: string): Promise<number> {
  const [userRow] = await db
    .select({ lastOpenedAt: users.lastActivityBellOpenedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const lastOpenedAt = userRow?.lastOpenedAt ?? null;

  const topThreeRows = await db
    .select({ id: activityItems.id })
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, userId),
      isNull(activityItems.deletedAt),
      gt(activityItems.createdAt, activityCutoff()),
      inArray(activityItems.type, HOME_TOP3_ELIGIBLE_TYPES as readonly string[]),
    ))
    .orderBy(desc(activityItems.createdAt))
    .limit(3);
  const topThreeIds = topThreeRows.map((row) => row.id);

  const sinceFloor = lastOpenedAt ?? activityCutoff();

  const conditions = [
    eq(activityItems.userId, userId),
    isNull(activityItems.deletedAt),
    gt(activityItems.createdAt, sinceFloor),
    inArray(activityItems.type, HOME_TOP3_ELIGIBLE_TYPES as readonly string[]),
  ];
  if (topThreeIds.length > 0) {
    conditions.push(notInArray(activityItems.id, topThreeIds));
  }

  const [row] = await db
    .select({ value: count() })
    .from(activityItems)
    .where(and(...conditions));

  return row?.value ?? 0;
}
