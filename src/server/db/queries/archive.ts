import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  dailyQueues,
  db,
  feedItems,
  generatedQuestions,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  questionRatings,
  questions,
  userQuestionBank,
  users,
} from '@/server/db';
import type { QueueSlot } from '@/server/daily/types';

export type ArchiveSource = 'daily' | 'feed' | 'joshing_game' | 'sent_to_me' | 'written_by_me';
export type ArchiveResultFilter = 'correct' | 'incorrect' | 'skipped';

export type ArchiveItem = {
  id: string;
  questionId: string;
  questionText: string;
  domain: string;
  domainDisplayName: string;
  source: ArchiveSource;
  sourceLabel: string;
  result: ArchiveResultFilter | null;
  submittedAnswer: string | null;
  correctAnswer: string;
  explanation: string | null;
  pointsAwarded: number | null;
  answeredAt: string | null;
  isInBank: boolean;
  myRating: 'up' | 'down' | null;
  canUseQuestionActions: boolean;
  verified: boolean;
  askerName: string;
};

export type ArchiveKind = 'all' | 'answered';

export type ArchiveResult = {
  items: ArchiveItem[];
  nextCursor: string | null;
};

export type ArchiveFacet = {
  domain: string;
  domainDisplayName: string;
};

export type ArchiveFacets = {
  totalCount: number;
  correctCount: number;
  domains: ArchiveFacet[];
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function displayNameForDomain(domain: string): string {
  return domain
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'General';
}

function questionDomain(question: typeof questions.$inferSelect | null | undefined): string {
  return question?.canonicalSubcategory || question?.broadCategory || question?.category || 'General';
}

function questionExplanation(question: typeof questions.$inferSelect | null | undefined): string | null {
  return question?.explainerFull
    ?? question?.explainerBrief
    ?? question?.factualExplanation
    ?? null;
}

function dateLabel(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function personName(value: string | null | undefined): string {
  return value?.trim() || 'A friend';
}

function encodeCursor(item: ArchiveItem): string {
  const time = item.answeredAt ? new Date(item.answeredAt).getTime() : 0;
  return Buffer.from(JSON.stringify({ answeredAt: time, id: item.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { answeredAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      answeredAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.answeredAt !== 'number' || typeof parsed.id !== 'string') return null;
    return { answeredAt: parsed.answeredAt, id: parsed.id };
  } catch {
    return null;
  }
}

function compareArchiveItems(a: ArchiveItem, b: ArchiveItem): number {
  const aTime = a.answeredAt ? new Date(a.answeredAt).getTime() : 0;
  const bTime = b.answeredAt ? new Date(b.answeredAt).getTime() : 0;
  return bTime - aTime || b.id.localeCompare(a.id);
}

function afterCursor(item: ArchiveItem, cursor: { answeredAt: number; id: string }): boolean {
  const time = item.answeredAt ? new Date(item.answeredAt).getTime() : 0;
  return time < cursor.answeredAt || (time === cursor.answeredAt && item.id < cursor.id);
}

async function decorateItems(userId: string, items: ArchiveItem[]): Promise<ArchiveItem[]> {
  const actionableIds = [...new Set(items.filter((item) => item.canUseQuestionActions).map((item) => item.questionId))];
  if (actionableIds.length === 0) return items;

  const [bankRows, ratingRows] = await Promise.all([
    db
      .select({ questionId: userQuestionBank.questionId })
      .from(userQuestionBank)
      .where(and(eq(userQuestionBank.userId, userId), inArray(userQuestionBank.questionId, actionableIds))),
    db
      .select({ questionId: questionRatings.questionId, rating: questionRatings.rating })
      .from(questionRatings)
      .where(and(eq(questionRatings.userId, userId), inArray(questionRatings.questionId, actionableIds))),
  ]);

  const banked = new Set(bankRows.map((row) => row.questionId));
  const ratingByQuestionId = new Map<string, 'up' | 'down' | null>(
    ratingRows.map((row) => [row.questionId, row.rating === 'up' || row.rating === 'down' ? row.rating : null]),
  );

  return items.map((item) => ({
    ...item,
    isInBank: item.canUseQuestionActions ? banked.has(item.questionId) : false,
    myRating: item.canUseQuestionActions ? ratingByQuestionId.get(item.questionId) ?? null : null,
  }));
}

async function readDailyItems(userId: string): Promise<ArchiveItem[]> {
  const queues = await db
    .select()
    .from(dailyQueues)
    .where(eq(dailyQueues.userId, userId))
    .orderBy(desc(dailyQueues.queueDate));

  const generatedIds = queues.flatMap((queue) =>
    asQueueSlots(queue.slots).map((slot) => slot.generated_question_id).filter((id): id is string => Boolean(id)),
  );
  const bankQuestionIds = queues.flatMap((queue) =>
    asQueueSlots(queue.slots).map((slot) => slot.question_id).filter((id): id is string => Boolean(id)),
  );

  const [generatedRows, questionRows] = await Promise.all([
    generatedIds.length
      ? db.select().from(generatedQuestions).where(inArray(generatedQuestions.id, [...new Set(generatedIds)]))
      : Promise.resolve([]),
    bankQuestionIds.length
      ? db.select().from(questions).where(inArray(questions.id, [...new Set(bankQuestionIds)]))
      : Promise.resolve([]),
  ]);

  const generatedById = new Map(generatedRows.map((question) => [question.id, question]));
  const questionById = new Map(questionRows.map((question) => [question.id, question]));

  const creatorIds = [...new Set(questionRows.map((q) => q.creatorId).filter((id): id is string => Boolean(id)))];
  const creatorRows = creatorIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, creatorIds))
    : [];
  const creatorById = new Map(creatorRows.map((row) => [row.id, row.displayName]));

  return queues.flatMap((queue) =>
    asQueueSlots(queue.slots)
      .filter((slot) => slot.answered || slot.skipped)
      .map((slot) => {
        const generated = slot.generated_question_id ? generatedById.get(slot.generated_question_id) : null;
        const bankQuestion = slot.question_id ? questionById.get(slot.question_id) : null;
        const domain = slot.domain || generated?.canonicalSubcategory || questionDomain(bankQuestion);
        const questionId = slot.question_id ?? slot.generated_question_id ?? `${queue.id}:${slot.slot_index}`;
        const askerDisplay = bankQuestion?.creatorId ? creatorById.get(bankQuestion.creatorId) ?? null : null;
        return {
          id: `daily:${queue.id}:${slot.slot_index}`,
          questionId,
          questionText: slot.question_text || generated?.questionText || bankQuestion?.questionText || '',
          domain,
          domainDisplayName: displayNameForDomain(domain),
          source: 'daily',
          sourceLabel: `Daily Five · ${dateLabel(String(queue.queueDate))}`,
          result: slot.skipped ? 'skipped' : slot.answer_state === 'correct' ? 'correct' : 'incorrect',
          submittedAnswer: slot.submitted_answer ?? null,
          correctAnswer: slot.reveal_canonical_answer ?? generated?.answer ?? bankQuestion?.answerText ?? '',
          explanation: slot.reveal_explainer ?? generated?.explainer ?? questionExplanation(bankQuestion),
          pointsAwarded: slot.awarded_points ?? null,
          answeredAt: queue.createdAt.toISOString(),
          isInBank: false,
          myRating: null,
          canUseQuestionActions: Boolean(slot.question_id),
          verified: bankQuestion?.verified ?? true,
          askerName: askerDisplay ?? (generated ? 'Daily Five' : ''),
        } satisfies ArchiveItem;
      }),
  );
}

async function readFeedItems(userId: string, source?: ArchiveSource): Promise<ArchiveItem[]> {
  const creatorUsers = alias(users, 'creator_users');
  const rows = await db
    .select({
      feedItem: feedItems,
      question: questions,
      sourceUser: { displayName: users.displayName },
      creatorUser: { displayName: creatorUsers.displayName },
    })
    .from(feedItems)
    .innerJoin(questions, eq(feedItems.questionId, questions.id))
    .innerJoin(users, eq(feedItems.sourceUserId, users.id))
    .leftJoin(creatorUsers, eq(questions.creatorId, creatorUsers.id))
    .where(and(eq(feedItems.recipientUserId, userId), eq(feedItems.state, 'answered')))
    .orderBy(desc(feedItems.sourceEventAt));

  const relevantRows = rows.filter((row) => {
    if (source === 'sent_to_me') return row.feedItem.sourceType === 'direct_sent';
    if (source === 'feed') return row.feedItem.sourceType !== 'direct_sent';
    return true;
  });

  const feedIds = relevantRows.map((row) => row.feedItem.id);
  const eventRows = feedIds.length
    ? await db
        .select({
          answerId: masteryEvents.answerId,
          questionId: masteryEvents.questionId,
          awardedPoints: masteryEvents.awardedPoints,
          createdAt: masteryEvents.createdAt,
        })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          eq(masteryEvents.answeredByUserId, userId),
          eq(masteryEvents.sessionContext, 'feed'),
          inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
        ))
    : [];
  const eventByFeedId = new Map<string, (typeof eventRows)[number]>();
  for (const event of eventRows) {
    const feedId = event.answerId?.split(':')[1];
    if (feedId) eventByFeedId.set(feedId, event);
  }

  return relevantRows.map(({ feedItem, question, sourceUser, creatorUser }) => {
    const sourceName = personName(sourceUser.displayName);
    const domain = questionDomain(question);
    const correctEvent = eventByFeedId.get(feedItem.id);
    const archiveSource: ArchiveSource = feedItem.sourceType === 'direct_sent' ? 'sent_to_me' : 'feed';
    return {
      id: `${archiveSource}:${feedItem.id}`,
      questionId: question.id,
      questionText: question.questionText,
      domain,
      domainDisplayName: displayNameForDomain(domain),
      source: archiveSource,
      sourceLabel: feedItem.sourceType === 'direct_sent' ? `From ${sourceName}` : `Feed · ${sourceName}`,
      result: correctEvent ? 'correct' : 'incorrect',
      submittedAnswer: feedItem.submittedAnswer ?? null,
      correctAnswer: question.answerText,
      explanation: questionExplanation(question),
      pointsAwarded: correctEvent ? Number(correctEvent.awardedPoints ?? 0) : 0,
      answeredAt: (correctEvent?.createdAt ?? feedItem.sourceEventAt).toISOString(),
      isInBank: false,
      myRating: null,
      canUseQuestionActions: true,
      verified: question.verified,
      askerName: creatorUser?.displayName ?? '',
    } satisfies ArchiveItem;
  });
}

async function readJoshingGameItems(userId: string): Promise<ArchiveItem[]> {
  const creatorUsers = alias(users, 'creator_users_jg');
  const rows = await db
    .select({
      response: joshingGameResponses,
      question: questions,
      game: { title: joshingGames.title },
      creatorUser: { displayName: creatorUsers.displayName },
    })
    .from(joshingGameResponses)
    .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
    .innerJoin(joshingGames, eq(joshingGameResponses.gameId, joshingGames.id))
    .leftJoin(creatorUsers, eq(questions.creatorId, creatorUsers.id))
    .where(eq(joshingGameResponses.userId, userId))
    .orderBy(desc(joshingGameResponses.answeredAt));

  return rows.map(({ response, question, game, creatorUser }) => {
    const domain = questionDomain(question);
    return {
      id: `joshing_game:${response.id}`,
      questionId: question.id,
      questionText: question.questionText,
      domain,
      domainDisplayName: displayNameForDomain(domain),
      source: 'joshing_game',
      sourceLabel: game.title || 'Joshing Game',
      result: response.isCorrect === null ? 'skipped' : response.isCorrect ? 'correct' : 'incorrect',
      submittedAnswer: response.submittedAnswer,
      correctAnswer: question.answerText,
      explanation: questionExplanation(question),
      pointsAwarded: response.pointsAwarded === null ? null : Number(response.pointsAwarded),
      answeredAt: (response.answeredAt ?? response.createdAt).toISOString(),
      isInBank: false,
      myRating: null,
      canUseQuestionActions: true,
      verified: question.verified,
      askerName: creatorUser?.displayName ?? '',
    } satisfies ArchiveItem;
  });
}

async function readWrittenByMeItems(userId: string): Promise<ArchiveItem[]> {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.creatorId, userId), isNull(questions.deletedAt)))
    .orderBy(desc(questions.createdAt));

  const questionIds = rows.map((question) => question.id);
  const creditRows = questionIds.length
    ? await db
        .select({
          questionId: masteryEvents.questionId,
          points: sql<number>`coalesce(sum(${masteryEvents.awardedPoints}), 0)`,
          answeredBy: sql<number>`count(distinct ${masteryEvents.answeredByUserId})`,
        })
        .from(masteryEvents)
        .where(and(
          eq(masteryEvents.userId, userId),
          eq(masteryEvents.sourceType, 'author_credit'),
          inArray(masteryEvents.questionId, questionIds),
          ne(masteryEvents.answeredByUserId, userId),
        ))
        .groupBy(masteryEvents.questionId)
    : [];

  const creditByQuestionId = new Map(creditRows.map((row) => [row.questionId, row]));

  return rows.map((question) => {
    const domain = questionDomain(question);
    const credit = creditByQuestionId.get(question.id);
    const answeredCount = Number(credit?.answeredBy ?? question.askedCount ?? 0);
    return {
      id: `written_by_me:${question.id}`,
      questionId: question.id,
      questionText: question.questionText,
      domain,
      domainDisplayName: displayNameForDomain(domain),
      source: 'written_by_me',
      sourceLabel: answeredCount === 1 ? 'Answered by 1 person' : `Answered by ${answeredCount} people`,
      result: null,
      submittedAnswer: null,
      correctAnswer: question.answerText,
      explanation: questionExplanation(question),
      pointsAwarded: credit ? Number(credit.points ?? 0) : null,
      answeredAt: question.createdAt.toISOString(),
      isInBank: false,
      myRating: null,
      canUseQuestionActions: true,
      verified: question.verified,
      askerName: '',
    } satisfies ArchiveItem;
  });
}

async function readAllArchiveItems(
  userId: string,
  source?: ArchiveSource,
  kind: ArchiveKind = 'all',
): Promise<ArchiveItem[]> {
  const readers: Promise<ArchiveItem[]>[] = [];
  if (!source || source === 'daily') readers.push(readDailyItems(userId));
  if (!source || source === 'feed' || source === 'sent_to_me') readers.push(readFeedItems(userId, source));
  if (!source || source === 'joshing_game') readers.push(readJoshingGameItems(userId));
  if (kind !== 'answered' && (!source || source === 'written_by_me')) readers.push(readWrittenByMeItems(userId));

  const items = (await Promise.all(readers)).flat();
  return decorateItems(userId, items);
}

function applyFilters(
  items: ArchiveItem[],
  params: { domain?: string; result?: ArchiveResultFilter },
): ArchiveItem[] {
  return items.filter((item) => {
    if (params.domain && item.domain !== params.domain) return false;
    if (params.result && item.result !== params.result) return false;
    return true;
  });
}

export async function getArchiveForUser(params: {
  userId: string;
  source?: ArchiveSource;
  domain?: string;
  result?: ArchiveResultFilter;
  limit?: number;
  cursor?: string;
  kind?: ArchiveKind;
}): Promise<ArchiveResult> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = decodeCursor(params.cursor);
  const allItems = applyFilters(
    await readAllArchiveItems(params.userId, params.source, params.kind),
    params,
  ).sort(compareArchiveItems);
  const cursorItems = cursor ? allItems.filter((item) => afterCursor(item, cursor)) : allItems;
  const pageItems = cursorItems.slice(0, limit);

  return {
    items: pageItems,
    nextCursor: cursorItems.length > limit ? encodeCursor(pageItems[pageItems.length - 1]!) : null,
  };
}

export async function getArchiveFacetsForUser(params: {
  userId: string;
  source?: ArchiveSource;
  domain?: string;
  result?: ArchiveResultFilter;
}): Promise<ArchiveFacets> {
  const allItems = await readAllArchiveItems(params.userId, params.source);
  const filtered = applyFilters(allItems, { domain: params.domain, result: params.result });
  const domainItems = applyFilters(allItems, { result: params.result });
  const domains = new Map<string, ArchiveFacet>();
  for (const item of domainItems) {
    domains.set(item.domain, { domain: item.domain, domainDisplayName: item.domainDisplayName });
  }

  return {
    totalCount: filtered.length,
    correctCount: filtered.filter((item) => item.result === 'correct').length,
    domains: [...domains.values()].sort((a, b) => a.domainDisplayName.localeCompare(b.domainDisplayName)),
  };
}
