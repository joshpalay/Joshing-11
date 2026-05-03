import { and, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';

import {
  activityItems,
  creatorNotes,
  db,
  feedItems,
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
import type { ActivityItemType } from '@/server/activity/write-activity';
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
      questionText: string;
    };
    directQuestion?: {
      feedItemId: string;
      questionText: string;
      personalMessage: string | null;
    };
    curatedQuestion?: {
      questionText: string;
    };
    creatorNote?: {
      id: string;
      questionText: string;
      correctAnswer: string;
      submittedAnswer: string | null;
      noteText: string;
      deliveredAt: Date | null;
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
    'received_direct_question',
    'reaction_received',
    'question_curated',
    'creator_note_received',
  ].includes(value);
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

  const tierRows = await Promise.all(rows.map(async (row) => {
    const [mastery] = await db
      .select({ tier: playerMastery.tier })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, row.userId),
        eq(playerMastery.canonicalSubcategory, row.domain),
      ))
      .limit(1);

    return [row.id, { domain: row.domain, tier: mastery?.tier ?? null }] as const;
  }));

  return new Map(tierRows);
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
    })
    .from(questionReactions)
    .innerJoin(questions, eq(questionReactions.questionId, questions.id))
    .where(inArray(questionReactions.id, reactionIds));

  return new Map(rows.map((row) => {
    const reaction = getCannedReaction(row.reactionType);
    return [
      row.id,
      {
        id: row.id,
        reactionLabel: reaction?.label ?? row.reactionType,
        reactionEmoji: reaction?.emoji ?? '',
        customMessage: row.customMessage,
        repliedAt: row.repliedAt,
        questionText: row.questionText,
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
      personalMessage: feedItems.personalMessage,
      questionText: questions.questionText,
    })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .where(inArray(feedItems.id, feedItemIds));

  return new Map(rows.map((row) => [
    row.feedItemId,
    {
      feedItemId: row.feedItemId,
      questionText: row.questionText,
      personalMessage: row.personalMessage,
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
    })
    .from(questions)
    .where(inArray(questions.id, questionIds));

  return new Map(rows.map((row) => [row.id, { questionText: row.questionText }] as const));
}

async function hydrateCreatorNotes(items: ActivityItemRow[]) {
  const noteIds = [
    ...new Set(
      items
        .filter((item) => item.referenceType === 'creator_note')
        .map((item) => item.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (noteIds.length === 0) {
    return new Map<string, NonNullable<ActivityItemView['reference']['creatorNote']>>();
  }

  const rows = await db
    .select({
      note: creatorNotes,
      questionText: questions.questionText,
      correctAnswer: questions.answerText,
    })
    .from(creatorNotes)
    .innerJoin(questions, eq(creatorNotes.questionId, questions.id))
    .where(inArray(creatorNotes.id, noteIds));

  const questionIds = [...new Set(rows.map((row) => row.note.questionId))];
  const feedItemIds = [
    ...new Set(
      rows
        .filter((row) => row.note.contextType === 'feed')
        .map((row) => row.note.contextId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const gameRows = questionIds.length > 0
    ? await db
        .select({
          questionId: joshingGameResponses.questionId,
          userId: joshingGameResponses.userId,
          submittedAnswer: joshingGameResponses.submittedAnswer,
        })
        .from(joshingGameResponses)
        .where(inArray(joshingGameResponses.questionId, questionIds))
    : [];
  const feedRows = feedItemIds.length > 0
    ? await db
        .select({
          feedItemId: feedItems.id,
          submittedAnswer: feedItems.submittedAnswer,
        })
        .from(feedItems)
        .where(inArray(feedItems.id, feedItemIds))
    : [];

  const submittedByQuestionUser = new Map(
    gameRows.map((row) => [`${row.questionId}:${row.userId}`, row.submittedAnswer] as const),
  );
  const submittedByFeedItem = new Map(
    feedRows.map((row) => [row.feedItemId, row.submittedAnswer] as const),
  );

  return new Map(rows.map((row) => [
    row.note.id,
    {
      id: row.note.id,
      questionText: row.questionText,
      correctAnswer: row.correctAnswer,
      submittedAnswer: row.note.contextType === 'feed' && row.note.contextId
        ? submittedByFeedItem.get(row.note.contextId) ?? null
        : submittedByQuestionUser.get(`${row.note.questionId}:${row.note.recipientUserId}`) ?? null,
      noteText: row.note.noteText,
      deliveredAt: row.note.deliveredAt,
    },
  ] as const));
}

export async function getActivitiesForUser(userId: string): Promise<ActivityItemView[]> {
  const rows = await db
    .select()
    .from(activityItems)
    .where(and(
      eq(activityItems.userId, userId),
      isNull(activityItems.deletedAt),
      gt(activityItems.createdAt, activityCutoff()),
    ))
    .orderBy(desc(activityItems.createdAt))
    .limit(100);

  const [actorsById, gamesById, masteryEventsById, reactionsById, directQuestionsById, curatedQuestionsById, creatorNotesById] = await Promise.all([
    hydrateActors(rows),
    hydrateGames(rows, userId),
    hydrateMasteryEvents(rows),
    hydrateReactions(rows),
    hydrateDirectQuestions(rows),
    hydrateCuratedQuestions(rows),
    hydrateCreatorNotes(rows),
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
        curatedQuestion: row.referenceType === 'question' && row.referenceId
          ? curatedQuestionsById.get(row.referenceId)
          : undefined,
        creatorNote: row.referenceType === 'creator_note' && row.referenceId
          ? creatorNotesById.get(row.referenceId)
          : undefined,
      },
    }));
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
    const pgError = error as { code?: string; message?: string };
    const missingCamelCaseColumn = pgError.code === '42703'
      && (pgError.message?.includes('recipientUserId') || pgError.message?.includes('repliedAt'));
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
