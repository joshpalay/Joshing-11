import { and, countDistinct, desc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';

import {
  db,
  feedItems,
  joshingGameQuestions,
  joshingGameResponses,
  joshingGames,
  masteryEvents,
  questions,
  userQuestionBank,
} from '@/server/db';
import { broadCategoryDisplayName } from '@/lib/question-categorization';
import { pgErrorCode } from '@/server/db/pg-error';
import { embedAndResolveDuplicate } from '@/server/pool/dedup';
import { resolveFinestNode } from '@/server/knowledge/graph';
import {
  getActiveIncorrectReportsForAuthor,
  getUpheldInappropriateForAuthor,
} from '@/server/db/queries/content-reports';

export type QuestionView = {
  id: string;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  broadCategory: string | null;
  canonicalSubcategory: string | null;
  subcategory: string | null;
  difficulty: number;
  timesAnswered: number;
  timesCorrect: number;
  correctRate: number;
  createdAt: string;
  lastUsedAt: string | null;
  usedInGamesCount: number;
  question_text: string;
  answer_text: string;
  accepted_alternatives: string[];
  category: string;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist' | null;
  creator_id: string | null;
  created_at: string;
  updated_at: string;
  breadcrumb_context: string | null;
  short_label: string | null;
  answer_source: string | null;
  question_type: string;
  minimum_required: number | null;
  category_overridden: boolean;
  creator_note: string | null;
  visibility: string;
  tags: string[];
  asked_count: number;
  correct_count: number;
  // "Nobody got it" QA signal (B4 Phase 2): ≥N holders tried, none correct.
  nobody_correct_flag: boolean;
  isInBank?: boolean;
  isOwnAuthored?: boolean;
  authorName?: string;
  verified: boolean;
  llmSuggestedAnswer: string | null;
  critiqueIterations: number;
  answerers?: { names: string[]; total: number };
  // B-Report-4: quiet author-facing content-report state on the author's own bank
  // rows. Absent for everyone else and for house/machine content (never surfaced).
  reportState?: QuestionReportState | null;
};

// "needs_attention" carries the correction (note + kind + suggested answer) but
// never the reporter's identity; "removed" is the read-only upheld-inappropriate
// terminal state.
export type QuestionReportState =
  | {
      kind: 'needs_attention';
      note: string;
      incorrectKind: 'answer_key' | 'premise' | null;
      suggestedAnswer: string | null;
    }
  | { kind: 'removed'; category: 'inappropriate' };

export type QuestionMutationResult = { ok: boolean; reason?: 'not_found' | 'in_use' };

type QuestionRow = typeof questions.$inferSelect;

// The lazy surface_priority_score ALTER shim that lived here moved to the
// boot guard chain in src/instrumentation.ts (where the repo keeps its
// idempotent schema guards); migration 0024 owns the journaled DDL.

const questionTableColumns = getTableColumns(questions);
const questionViewColumns = {
  id: questionTableColumns.id,
  creatorId: questionTableColumns.creatorId,
  generatedQuestionId: questionTableColumns.generatedQuestionId,
  source: questionTableColumns.source,
  sourceQuestionId: questionTableColumns.sourceQuestionId,
  sourceCreatorId: questionTableColumns.sourceCreatorId,
  questionText: questionTableColumns.questionText,
  breadcrumbContext: questionTableColumns.breadcrumbContext,
  answerText: questionTableColumns.answerText,
  factualExplanation: questionTableColumns.factualExplanation,
  acceptedAlternatives: questionTableColumns.acceptedAlternatives,
  answerSource: questionTableColumns.answerSource,
  questionType: questionTableColumns.questionType,
  minimumRequired: questionTableColumns.minimumRequired,
  category: questionTableColumns.category,
  broadCategory: questionTableColumns.broadCategory,
  subcategory: questionTableColumns.subcategory,
  canonicalSubcategory: questionTableColumns.canonicalSubcategory,
  categoryOverridden: questionTableColumns.categoryOverridden,
  creatorNote: questionTableColumns.creatorNote,
  insideJoke: questionTableColumns.insideJoke,
  difficultyEstimate: questionTableColumns.difficultyEstimate,
  llmDifficulty: questionTableColumns.llmDifficulty,
  calibratedDifficulty: questionTableColumns.calibratedDifficulty,
  correctRate: questionTableColumns.correctRate,
  explainerBrief: questionTableColumns.explainerBrief,
  explainerFull: questionTableColumns.explainerFull,
  explainerBriefCorrect: questionTableColumns.explainerBriefCorrect,
  explainerFullCorrect: questionTableColumns.explainerFullCorrect,
  explainerBriefWrong: questionTableColumns.explainerBriefWrong,
  explainerFullWrong: questionTableColumns.explainerFullWrong,
  explainerBriefExpired: questionTableColumns.explainerBriefExpired,
  explainerFullExpired: questionTableColumns.explainerFullExpired,
  shortLabel: questionTableColumns.shortLabel,
  status: questionTableColumns.status,
  visibility: questionTableColumns.visibility,
  publicStatus: questionTableColumns.publicStatus,
  publicEligibilityScore: questionTableColumns.publicEligibilityScore,
  publicEligibilityReason: questionTableColumns.publicEligibilityReason,
  sharedToFriendsFeed: questionTableColumns.sharedToFriendsFeed,
  askedCount: questionTableColumns.askedCount,
  correctCount: questionTableColumns.correctCount,
  // "Nobody got it" review smell (B4 Phase 2) — surfaced as a QA signal.
  nobodyCorrectFlag: questionTableColumns.nobodyCorrectFlag,
  createdAt: questionTableColumns.createdAt,
  updatedAt: questionTableColumns.updatedAt,
  deletedAt: questionTableColumns.deletedAt,
};

export const bankQuestionSelectColumns = questionViewColumns;

// The pool-substrate fields (B1) are not part of the rendered question view, so
// they are excluded here like the other non-view columns — partial selects
// (e.g. bankQuestionSelectColumns) need not fetch them.
type QuestionViewNonViewKey =
  | 'verified' | 'llmSuggestedAnswer' | 'critiqueIterations' | 'surfacePriorityScore'
  | 'trustTier' | 'perishable' | 'sourceRefs' | 'isDuplicate' | 'suppressedBy' | 'embedding'
  // categorizeProvider: B3 provenance, not surfaced in the question view.
  | 'authorDeleted' | 'subjectEntity' | 'categorizeProvider'
  // B-QUESTION-QUALITY-AGENTS-01 (0096) + B-CRAFTER-LIFECYCLE-01 (0100): batch-
  // verification stamp + reason, not part of the rendered view — partial selects
  // need not fetch them.
  | 'verifiedAt' | 'verificationVerdict' | 'verificationReason';
type QuestionViewRow = Omit<QuestionRow, QuestionViewNonViewKey>
  & Partial<Pick<QuestionRow, QuestionViewNonViewKey>>;

function difficultyToNumber(value: QuestionRow['difficultyEstimate']): number {
  if (value === 'accessible') return 1;
  if (value === 'specialist') return 5;
  return 3;
}

function numberToDifficulty(value: number): 'accessible' | 'moderate' | 'specialist' {
  if (value <= 2) return 'accessible';
  if (value >= 4) return 'specialist';
  return 'moderate';
}

function explanationFor(row: QuestionViewRow): string | null {
  return row.factualExplanation
    ?? row.explainerFullWrong
    ?? row.explainerFull
    ?? row.explainerBriefWrong
    ?? row.explainerBrief
    ?? null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type QuestionStats = {
  timesAnswered: number;
  timesCorrect: number;
  correctRate: number;
  lastUsedAt: string | null;
  usedInGamesCount: number;
};

export const EMPTY_QUESTION_STATS: QuestionStats = {
  timesAnswered: 0,
  timesCorrect: 0,
  correctRate: 0,
  lastUsedAt: null,
  usedInGamesCount: 0,
};

type StatCountRow = { questionId: string | null; timesAnswered: number; timesCorrect: number };
type GameUsageRow = { questionId: string | null; lastUsedAt: Date | null; usedInGamesCount: number };

// Pure merge of the three GROUP BY result sets into per-question stats. Extracted
// from readQuestionStatsForIds so the count-combining and correctRate rounding is
// unit-testable without a DB. Every requested id is present in the result (zero-
// filled when it has no answers/usage rows).
export function mergeQuestionStats(
  questionIds: string[],
  responseRows: StatCountRow[],
  feedRows: StatCountRow[],
  gameRows: GameUsageRow[],
): Map<string, QuestionStats> {
  const answered = new Map<string, number>();
  const correct = new Map<string, number>();
  for (const row of [...responseRows, ...feedRows]) {
    if (!row.questionId) continue;
    answered.set(row.questionId, (answered.get(row.questionId) ?? 0) + Number(row.timesAnswered ?? 0));
    correct.set(row.questionId, (correct.get(row.questionId) ?? 0) + Number(row.timesCorrect ?? 0));
  }

  const usage = new Map<string, { lastUsedAt: string | null; usedInGamesCount: number }>();
  for (const row of gameRows) {
    if (!row.questionId) continue;
    usage.set(row.questionId, {
      lastUsedAt: toIso(row.lastUsedAt ?? null),
      usedInGamesCount: Number(row.usedInGamesCount ?? 0),
    });
  }

  const result = new Map<string, QuestionStats>();
  for (const id of questionIds) {
    const timesAnswered = answered.get(id) ?? 0;
    const timesCorrect = correct.get(id) ?? 0;
    const use = usage.get(id);
    result.set(id, {
      timesAnswered,
      timesCorrect,
      correctRate: timesAnswered > 0 ? Math.round((timesCorrect / timesAnswered) * 100) : 0,
      lastUsedAt: use?.lastUsedAt ?? null,
      usedInGamesCount: use?.usedInGamesCount ?? 0,
    });
  }
  return result;
}

// Set-based replacement for the per-question readQuestionStats N+1: computes the
// same stats for every id in 3 GROUP BY question_id queries total. The pg pool is
// capped at max 5 (src/server/db/index.ts), so collapsing round-trips matters more
// than parallelism. Note: questions.asked_count/correct_count are NOT a substitute
// here — they only track joshing-game answers (joshing-game.ts), while these stats
// also count "Send to friend" answers recorded in feedItems.
export async function readQuestionStatsForIds(
  questionIds: string[],
): Promise<Map<string, QuestionStats>> {
  const ids = [...new Set(questionIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const [responseRows, feedRows, gameRows] = await Promise.all([
    db
      .select({
        questionId: joshingGameResponses.questionId,
        timesAnswered: sql<number>`count(*)`,
        timesCorrect: sql<number>`count(*) filter (where ${joshingGameResponses.isCorrect} = true)`,
      })
      .from(joshingGameResponses)
      .where(and(
        inArray(joshingGameResponses.questionId, ids),
        sql`${joshingGameResponses.answeredAt} is not null`,
      ))
      .groupBy(joshingGameResponses.questionId),
    // Answers submitted via "Send to friend" land in feedItems, not joshingGameResponses.
    // joshingGameId is null filters out feed items that mirror an already-counted game response.
    db
      .select({
        questionId: feedItems.questionId,
        timesAnswered: sql<number>`count(*)`,
        timesCorrect: sql<number>`count(*) filter (where ${feedItems.answerResult} = 'correct')`,
      })
      .from(feedItems)
      .where(and(
        inArray(feedItems.questionId, ids),
        sql`${feedItems.answerResult} is not null`,
        isNull(feedItems.joshingGameId),
      ))
      .groupBy(feedItems.questionId),
    db
      .select({
        questionId: joshingGameQuestions.questionId,
        lastUsedAt: sql<Date | null>`max(${joshingGames.createdAt})`,
        usedInGamesCount: countDistinct(joshingGameQuestions.gameId),
      })
      .from(joshingGameQuestions)
      .innerJoin(joshingGames, eq(joshingGameQuestions.gameId, joshingGames.id))
      .where(inArray(joshingGameQuestions.questionId, ids))
      .groupBy(joshingGameQuestions.questionId),
  ]);

  return mergeQuestionStats(ids, responseRows, feedRows, gameRows);
}

async function readQuestionStats(questionId: string): Promise<QuestionStats> {
  const stats = await readQuestionStatsForIds([questionId]);
  return stats.get(questionId) ?? EMPTY_QUESTION_STATS;
}

export function buildQuestionView(row: QuestionViewRow, stats: QuestionStats): QuestionView {
  const domain = row.canonicalSubcategory ?? row.category;
  const createdAt = toIso(row.createdAt) ?? new Date().toISOString();
  const updatedAt = toIso(row.updatedAt) ?? createdAt;

  return {
    id: row.id,
    text: row.questionText,
    correctAnswer: row.answerText,
    alternateAnswers: row.acceptedAlternatives ?? [],
    explanation: explanationFor(row),
    domain,
    domainDisplayName: row.canonicalSubcategory ?? broadCategoryDisplayName(domain),
    broadCategory: row.broadCategory,
    canonicalSubcategory: row.canonicalSubcategory,
    subcategory: row.subcategory,
    difficulty: difficultyToNumber(row.calibratedDifficulty ?? row.llmDifficulty ?? row.difficultyEstimate),
    timesAnswered: stats.timesAnswered,
    timesCorrect: stats.timesCorrect,
    correctRate: stats.correctRate,
    createdAt,
    lastUsedAt: stats.lastUsedAt,
    usedInGamesCount: stats.usedInGamesCount,
    question_text: row.questionText,
    answer_text: row.answerText,
    accepted_alternatives: row.acceptedAlternatives ?? [],
    category: row.category,
    difficulty_estimate: row.difficultyEstimate,
    creator_id: row.creatorId,
    created_at: createdAt,
    updated_at: updatedAt,
    breadcrumb_context: row.breadcrumbContext,
    short_label: row.shortLabel,
    answer_source: row.answerSource,
    question_type: row.questionType,
    minimum_required: row.minimumRequired,
    category_overridden: row.categoryOverridden,
    creator_note: row.creatorNote,
    visibility: row.visibility,
    tags: [],
    asked_count: row.askedCount,
    correct_count: row.correctCount,
    nobody_correct_flag: row.nobodyCorrectFlag ?? false,
    verified: row.verified ?? true,
    llmSuggestedAnswer: row.llmSuggestedAnswer ?? null,
    critiqueIterations: row.critiqueIterations ?? 0,
  };
}

export async function toQuestionView(row: QuestionViewRow): Promise<QuestionView> {
  const stats = await readQuestionStats(row.id);
  return buildQuestionView(row, stats);
}

export async function getQuestionsForUser(userId: string): Promise<QuestionView[]> {
  const { getBankedQuestions } = await import('@/server/db/queries/bank');
  const views = await getBankedQuestions(userId, { onlyAuthored: true });
  return attachAuthorReportState(userId, views);
}

// B-Report-4: attach the quiet author-facing report state to the author's own
// authored rows. The read helpers already enforce the house guard server-side, so
// house/machine content can never receive a state. "removed" (upheld inappropriate)
// takes precedence over "needs attention" (open incorrect) on the same question.
async function attachAuthorReportState(
  userId: string,
  views: QuestionView[],
): Promise<QuestionView[]> {
  const ownIds = views
    .filter((view) => view.isOwnAuthored && view.creator_id === userId)
    .map((view) => view.id);
  if (ownIds.length === 0) return views;

  const [incorrectByQuestion, removed] = await Promise.all([
    getActiveIncorrectReportsForAuthor(userId, ownIds),
    getUpheldInappropriateForAuthor(userId, ownIds),
  ]);
  if (incorrectByQuestion.size === 0 && removed.size === 0) return views;

  return views.map((view) => {
    if (removed.has(view.id)) {
      return { ...view, reportState: { kind: 'removed', category: 'inappropriate' } };
    }
    const incorrect = incorrectByQuestion.get(view.id);
    if (incorrect) {
      return {
        ...view,
        reportState: {
          kind: 'needs_attention',
          note: incorrect.note,
          incorrectKind: incorrect.incorrectKind,
          suggestedAnswer: incorrect.suggestedAnswer,
        },
      };
    }
    return view;
  });
}

export async function hasUserAuthoredAnyQuestion(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.creatorId, userId), isNull(questions.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

export type AuthoredQuestionPreview = {
  id: string;
  questionText: string;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  difficulty: 'accessible' | 'moderate' | 'specialist' | null;
  createdAt: string;
  viewerAnswered: { result: 'correct' | 'incorrect' } | null;
};

export async function getAuthoredQuestionsForUser(params: {
  userId: string;
  limit?: number;
  viewerUserId?: string;
  // The effective viewer relationship to the author, precomputed by the
  // caller (the profile page uses portrait.visibility). Defaults to
  // 'self' when viewerUserId matches userId, else 'stranger' — the most
  // conservative interpretation.
  viewer?: 'self' | 'friend' | 'stranger';
  // Whether the authored_questions section is visible to the effective
  // viewer per PROFILE_SECTION_VISIBILITY. If false, returns []. Defaults
  // to true so callers that don't yet thread the section gate still see
  // questions (subject to the per-question filter below).
  sectionVisible?: boolean;
}): Promise<AuthoredQuestionPreview[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
  const viewer =
    params.viewer ??
    (params.viewerUserId === params.userId ? 'self' : 'stranger');

  // Section-level gate: when the section is hidden to the effective
  // viewer, render nothing regardless of per-question visibility.
  if (params.sectionVisible === false) return [];

  // Per-question filter: self sees everything; friends see public+friends;
  // strangers see only public.
  const whereClauses = [
    eq(questions.creatorId, params.userId),
    isNull(questions.deletedAt),
    eq(questions.source, 'authored'),
  ];
  if (viewer === 'stranger') {
    whereClauses.push(eq(questions.visibility, 'public'));
  } else if (viewer === 'friend') {
    whereClauses.push(inArray(questions.visibility, ['public', 'friends']));
  }

  const rows = await db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      calibratedDifficulty: questions.calibratedDifficulty,
      llmDifficulty: questions.llmDifficulty,
      difficultyEstimate: questions.difficultyEstimate,
      createdAt: questions.createdAt,
    })
    .from(questions)
    .where(and(...whereClauses))
    .orderBy(desc(questions.createdAt))
    .limit(limit);

  const viewerStatus = new Map<string, { result: 'correct' | 'incorrect' }>();
  if (params.viewerUserId && rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const events = await db
      .select({
        questionId: masteryEvents.questionId,
        answerState: masteryEvents.answerState,
      })
      .from(masteryEvents)
      .where(
        and(
          eq(masteryEvents.userId, params.viewerUserId),
          eq(masteryEvents.answeredByUserId, params.viewerUserId),
          inArray(masteryEvents.questionId, ids),
        ),
      );

    for (const event of events) {
      if (!event.questionId) continue;
      const isCorrect = event.answerState !== null && event.answerState !== 'incorrect';
      const existing = viewerStatus.get(event.questionId);
      if (isCorrect) {
        viewerStatus.set(event.questionId, { result: 'correct' });
      } else if (!existing) {
        viewerStatus.set(event.questionId, { result: 'incorrect' });
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    questionText: row.questionText,
    canonicalSubcategory: row.canonicalSubcategory,
    broadCategory: row.broadCategory,
    difficulty:
      row.calibratedDifficulty ?? row.llmDifficulty ?? row.difficultyEstimate ?? null,
    createdAt: row.createdAt.toISOString(),
    viewerAnswered: viewerStatus.get(row.id) ?? null,
  }));
}

export async function getQuestion(questionId: string, userId: string): Promise<QuestionView | null> {
  const [row] = await db
    .select(questionViewColumns)
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.creatorId, userId), isNull(questions.deletedAt)))
    .limit(1);

  return row ? toQuestionView(row) : null;
}

export async function createQuestion(params: {
  authorId: string;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  category: string;
  broadCategory: string | null;
  subcategory: string;
  canonicalSubcategory: string;
  domain?: string;
  difficulty: number;
  creatorNote?: string | null;
  insideJoke?: string | null;
  verified: boolean;
  llmSuggestedAnswer?: string | null;
  critiqueIterations: number;
  publicStatus?: 'not_scored' | 'eligible_pending' | 'rejected' | 'opted_out' | 'migrated';
  publicEligibilityScore?: number | null;
  publicEligibilityReason?: string | null;
  // 'blocked' is set by the create route on a safety-fail vet verdict; it is
  // not user-selectable. See verdictToBlockedVisibility.
  visibility?: 'public' | 'friends' | 'private' | 'blocked';
  // B-LLM-PROVIDER-AB-SWITCH B3: which provider categorized this question.
  categorizeProvider?: string | null;
}): Promise<{ id: string }> {
  const visibility = params.visibility ?? 'public';

  // B-KNOWLEDGE-TAXONOMY-01 P3: normalize to the finest existing
  // KnowledgeNode's label (flag-off pass-through — byte-identical to today).
  // Covers every canonical write: authored, crafter keep, future callers.
  const canonicalSubcategory = await resolveFinestNode(params.canonicalSubcategory);

  const difficulty = numberToDifficulty(params.difficulty);
  const baseValues = {
    creatorId: params.authorId,
    questionText: params.text,
    answerText: params.correctAnswer,
    acceptedAlternatives: params.alternateAnswers,
    factualExplanation: params.explanation,
    creatorNote: params.creatorNote ?? null,
    insideJoke: params.insideJoke ?? null,
    category: params.category as typeof questions.$inferInsert.category,
    broadCategory: params.broadCategory,
    subcategory: params.subcategory,
    canonicalSubcategory,
    categoryOverridden: false,
    categorizeProvider: params.categorizeProvider ?? null,
    difficultyEstimate: difficulty,
    llmDifficulty: difficulty,
    calibratedDifficulty: difficulty,
    answerSource: params.llmSuggestedAnswer ? (params.verified ? 'llm_suggested' : 'llm_edited') : 'creator_written',
    questionType: 'factual',
    visibility,
    status: params.verified ? 'verified' : 'unverified',
    ...(params.publicStatus !== undefined ? { publicStatus: params.publicStatus } : {}),
    ...(params.publicEligibilityScore !== undefined ? { publicEligibilityScore: params.publicEligibilityScore } : {}),
    ...(params.publicEligibilityReason !== undefined ? { publicEligibilityReason: params.publicEligibilityReason } : {}),
  } satisfies Partial<typeof questions.$inferInsert>;

  const createWithValues = async (values: typeof questions.$inferInsert) => {
    const [created] = await db
      .insert(questions)
      .values(values)
      .returning({ id: questions.id });
    return created;
  };

  const createWithLegacyColumns = async () => {
    const answerSource = params.llmSuggestedAnswer
      ? (params.verified ? 'llm_suggested' : 'llm_edited')
      : 'creator_written';
    const status = params.verified ? 'verified' : 'unverified';
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO "Question" (
        "creator_id",
        "question_text",
        "answer_text",
        "factual_explanation",
        "accepted_alternatives",
        "answer_source",
        "question_type",
        "category",
        "broad_category",
        "subcategory",
        "canonical_subcategory",
        "category_overridden",
        "creator_note",
        "difficulty_estimate",
        "llm_difficulty",
        "calibrated_difficulty",
        "status",
        "visibility"
      )
      VALUES (
        ${params.authorId},
        ${params.text},
        ${params.correctAnswer},
        ${params.explanation},
        ${params.alternateAnswers}::text[],
        ${answerSource}::"AnswerSource",
        'factual'::"QuestionType",
        ${params.category}::"Category",
        ${params.broadCategory},
        ${params.subcategory},
        ${params.canonicalSubcategory},
        false,
        ${params.creatorNote ?? null},
        ${difficulty}::"DifficultyEstimate",
        ${difficulty}::"DifficultyEstimate",
        ${difficulty}::"DifficultyEstimate",
        ${status}::"QuestionStatus",
        ${visibility}::"QuestionVisibility"
      )
      RETURNING "id"
    `);
    const created = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!created) throw new Error('Failed to create legacy-compatible question');
    return created;
  };

  let created: { id: string };
  try {
    created = await createWithValues({
      ...baseValues,
      verified: params.verified,
      llmSuggestedAnswer: params.llmSuggestedAnswer ?? null,
      critiqueIterations: params.critiqueIterations,
    } as typeof questions.$inferInsert);
  } catch (error) {
    if (pgErrorCode(error) !== '42703') throw error;
    console.warn('[questions/create] current question columns unavailable; retrying legacy-compatible question insert', {
      userId: params.authorId,
      category: params.category,
      canonicalSubcategory: params.canonicalSubcategory,
    });
    try {
      created = await createWithValues(baseValues as typeof questions.$inferInsert);
    } catch (fallbackError) {
      if (pgErrorCode(fallbackError) !== '42703') throw fallbackError;
      console.warn('[questions/create] drizzle insert still references unavailable columns; saving with raw legacy-compatible insert', {
        userId: params.authorId,
        category: params.category,
      canonicalSubcategory: params.canonicalSubcategory,
      });
      created = await createWithLegacyColumns();
    }
  }

  await db
    .insert(userQuestionBank)
    .values({
      userId: params.authorId,
      questionId: created.id,
      addedFromContextType: 'manual',
    })
    .onConflictDoNothing({
      target: [userQuestionBank.userId, userQuestionBank.questionId],
    });

  // Semantic-dedup backstop (B1 pool substrate). Best-effort, no-op without a
  // VOYAGE_API_KEY. A human-authored question that collides with an existing
  // MACHINE pool row suppresses the *machine* row (human beats machine); a
  // collision with another human row suppresses this new one. Always flags,
  // never deletes.
  await embedAndResolveDuplicate({ id: created.id, origin: 'human', questionText: params.text });

  return { id: created.id };
}

export async function updateQuestion(params: {
  questionId: string;
  userId: string;
  text?: string;
  correctAnswer?: string;
  alternateAnswers?: string[];
  explanation?: string;
  category?: string;
  broadCategory?: string | null;
  subcategory?: string;
  canonicalSubcategory?: string;
  difficulty?: number;
  // B-LLM-PROVIDER-AB-SWITCH B3: provider that re-categorized this question.
  categorizeProvider?: string | null;
}): Promise<QuestionMutationResult> {
  const existing = await getQuestion(params.questionId, params.userId);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.usedInGamesCount > 0) return { ok: false, reason: 'in_use' };

  const values: Partial<typeof questions.$inferInsert> = { updatedAt: new Date() };
  if (params.text !== undefined) values.questionText = params.text;
  if (params.correctAnswer !== undefined) values.answerText = params.correctAnswer;
  if (params.alternateAnswers !== undefined) values.acceptedAlternatives = params.alternateAnswers;
  if (params.explanation !== undefined) values.factualExplanation = params.explanation || null;
  if (params.category !== undefined) {
    values.category = params.category as typeof questions.$inferInsert.category;
    values.categoryOverridden = false;
  }
  if (params.broadCategory !== undefined) values.broadCategory = params.broadCategory;
  if (params.subcategory !== undefined) values.subcategory = params.subcategory;
  if (params.canonicalSubcategory !== undefined) values.canonicalSubcategory = params.canonicalSubcategory;
  if (params.categorizeProvider !== undefined) values.categorizeProvider = params.categorizeProvider;
  if (params.difficulty !== undefined) {
    const difficulty = numberToDifficulty(params.difficulty);
    values.difficultyEstimate = difficulty;
    values.calibratedDifficulty = difficulty;
  }

  await db.update(questions).set(values).where(eq(questions.id, params.questionId));
  return { ok: true };
}

export async function deleteQuestion(params: {
  questionId: string;
  userId: string;
}): Promise<QuestionMutationResult> {
  const existing = await getQuestion(params.questionId, params.userId);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.usedInGamesCount > 0) return { ok: false, reason: 'in_use' };

  await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(questions.id, params.questionId));

  return { ok: true };
}
