import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';

import {
  categoryEnum,
  db,
  difficultyEstimateEnum,
  masterySourceTypeEnum,
  masteryEvents,
  questions,
  users,
} from '@/server/db';

export type Category = (typeof categoryEnum.enumValues)[number];
export type DifficultyEstimate = (typeof difficultyEstimateEnum.enumValues)[number];
export type MasterySourceType = (typeof masterySourceTypeEnum.enumValues)[number];

export const CATEGORY_VALUES = categoryEnum.enumValues;
export const DIFFICULTY_VALUES = difficultyEstimateEnum.enumValues;
export const SOURCE_TYPE_VALUES = masterySourceTypeEnum.enumValues;

export type PointsDiagnosticFilters = {
  category?: Category;
  difficulty?: DifficultyEstimate;
  sourceType?: MasterySourceType;
  from?: Date;
  to?: Date;
  limit?: number;
};

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

export type PointsDiagnosticRow = {
  masteryEventId: string;
  createdAt: string;
  sourceType: MasterySourceType;
  answerState: string | null;
  sessionContext: string | null;
  basePoints: number;
  weight: number;
  awardedPoints: number;
  eventCanonicalSubcategory: string;
  questionId: string | null;
  questionTextSnippet: string | null;
  category: Category | null;
  broadCategory: string | null;
  canonicalSubcategory: string | null;
  difficulty: DifficultyEstimate | null;
  correctRate: number | null;
  answeredByUserId: string | null;
  answeredByDisplayName: string | null;
};

export type UserMatch = {
  id: string;
  displayName: string | null;
  phoneNumber: string;
  email: string | null;
};

export type UserResolution = {
  match: UserMatch | null;
  nearMatches: UserMatch[];
};

export type PointsDiagnosticSummary = {
  eventCount: number;
  totalAwardedPoints: number;
  correctCount: number;
  incorrectCount: number;
  uniqueQuestions: number;
};

function snippet(text: string | null | undefined, max = 140): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export async function resolveUserByQuery(query: string): Promise<UserResolution> {
  const trimmed = query.trim();
  if (!trimmed) return { match: null, nearMatches: [] };

  const byId = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, trimmed))
    .limit(1);
  if (byId.length > 0) return { match: byId[0]!, nearMatches: [] };

  const candidates = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      phoneNumber: users.phoneNumber,
      email: users.email,
    })
    .from(users)
    .where(
      or(
        ilike(users.displayName, `%${trimmed}%`),
        eq(users.phoneNumber, trimmed),
        ilike(users.email, `%${trimmed}%`),
      ),
    )
    .orderBy(asc(users.displayName))
    .limit(10);

  if (candidates.length === 0) return { match: null, nearMatches: [] };
  if (candidates.length === 1) return { match: candidates[0]!, nearMatches: [] };
  return { match: null, nearMatches: candidates };
}

export async function loadPointsDiagnostic(
  userId: string,
  filters: PointsDiagnosticFilters,
): Promise<PointsDiagnosticRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const predicates = [eq(masteryEvents.userId, userId)];
  if (filters.sourceType) predicates.push(eq(masteryEvents.sourceType, filters.sourceType));
  if (filters.from) predicates.push(gte(masteryEvents.createdAt, filters.from));
  if (filters.to) predicates.push(lte(masteryEvents.createdAt, filters.to));
  if (filters.category) predicates.push(eq(questions.category, filters.category));
  if (filters.difficulty) {
    // Effective difficulty = calibratedDifficulty if set, else difficultyEstimate.
    predicates.push(
      sql`COALESCE(${questions.calibratedDifficulty}, ${questions.difficultyEstimate}) = ${filters.difficulty}`,
    );
  }

  const rows = await db
    .select({
      masteryEventId: masteryEvents.id,
      createdAt: masteryEvents.createdAt,
      sourceType: masteryEvents.sourceType,
      answerState: masteryEvents.answerState,
      sessionContext: masteryEvents.sessionContext,
      basePoints: masteryEvents.basePoints,
      weight: masteryEvents.weight,
      awardedPoints: masteryEvents.awardedPoints,
      eventCanonicalSubcategory: masteryEvents.canonicalSubcategory,
      questionId: masteryEvents.questionId,
      questionText: questions.questionText,
      category: questions.category,
      broadCategory: questions.broadCategory,
      questionCanonicalSubcategory: questions.canonicalSubcategory,
      calibratedDifficulty: questions.calibratedDifficulty,
      difficultyEstimate: questions.difficultyEstimate,
      correctRate: questions.correctRate,
      answeredByUserId: masteryEvents.answeredByUserId,
      answeredByDisplayName: users.displayName,
    })
    .from(masteryEvents)
    .leftJoin(questions, eq(masteryEvents.questionId, questions.id))
    .leftJoin(users, eq(masteryEvents.answeredByUserId, users.id))
    .where(and(...predicates))
    .orderBy(desc(masteryEvents.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    masteryEventId: row.masteryEventId,
    createdAt: row.createdAt.toISOString(),
    sourceType: row.sourceType,
    answerState: row.answerState,
    sessionContext: row.sessionContext,
    basePoints: row.basePoints ?? 0,
    weight: Number(row.weight ?? 0),
    awardedPoints: Number(row.awardedPoints ?? 0),
    eventCanonicalSubcategory: row.eventCanonicalSubcategory,
    questionId: row.questionId,
    questionTextSnippet: snippet(row.questionText),
    category: row.category,
    broadCategory: row.broadCategory,
    canonicalSubcategory: row.questionCanonicalSubcategory,
    difficulty: row.calibratedDifficulty ?? row.difficultyEstimate,
    correctRate: row.correctRate,
    answeredByUserId: row.answeredByUserId,
    answeredByDisplayName: row.answeredByDisplayName,
  }));
}

export function summarize(rows: PointsDiagnosticRow[]): PointsDiagnosticSummary {
  const uniqueQuestionIds = new Set<string>();
  let total = 0;
  let correct = 0;
  let incorrect = 0;
  for (const r of rows) {
    total += r.awardedPoints;
    if (r.questionId) uniqueQuestionIds.add(r.questionId);
    if (
      r.answerState === 'first_correct' ||
      r.answerState === 'first_correct_after_wrong' ||
      r.answerState === 'repeat_correct'
    ) {
      correct++;
    } else if (r.answerState === 'incorrect') {
      incorrect++;
    }
  }
  return {
    eventCount: rows.length,
    totalAwardedPoints: Math.round(total * 100) / 100,
    correctCount: correct,
    incorrectCount: incorrect,
    uniqueQuestions: uniqueQuestionIds.size,
  };
}
