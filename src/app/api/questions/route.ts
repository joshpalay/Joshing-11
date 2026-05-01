import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { validateBreadcrumbContext } from '@/lib/breadcrumb-validation';
import { categorizeQuestion, suggestTags } from '@/lib/llm';
import { getSession } from '@/server/auth/session';
import { db, questionAudienceTags, questions, userQuestionBank } from '@/server/db';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['music', 'literature', 'history', 'film_tv', 'sport', 'science', 'philosophy', 'pop_culture', 'language', 'other'] as const;
const VISIBILITIES = ['private', 'public'] as const;
const QUESTION_TYPES = ['factual', 'personal', 'ambiguous', 'factual_uncertain'] as const;
const DIFFICULTIES = ['accessible', 'moderate', 'specialist'] as const;
const ANSWER_SOURCES = ['llm_suggested', 'creator_written', 'llm_edited'] as const;

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function toQuestionRecord(row: typeof questions.$inferSelect, tags: string[] = []) {
  return {
    id: row.id,
    creator_id: row.creatorId,
    question_text: row.questionText,
    breadcrumb_context: row.breadcrumbContext,
    answer_text: row.answerText,
    short_label: row.shortLabel,
    accepted_alternatives: row.acceptedAlternatives,
    answer_source: row.answerSource,
    question_type: row.questionType,
    difficulty_estimate: row.difficultyEstimate,
    minimum_required: row.minimumRequired,
    category: row.category,
    category_overridden: row.categoryOverridden,
    creator_note: row.creatorNote,
    visibility: row.visibility,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    tags,
    asked_count: row.askedCount,
    correct_count: row.correctCount,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [ownedRows, bankRows] = await Promise.all([
    db.select().from(questions).where(and(eq(questions.creatorId, session.userId), isNull(questions.deletedAt))).orderBy(asc(questions.createdAt)),
    db
      .select({ question: questions })
      .from(userQuestionBank)
      .innerJoin(questions, eq(userQuestionBank.questionId, questions.id))
      .where(and(eq(userQuestionBank.userId, session.userId), isNull(questions.deletedAt))),
  ]);

  const byId = new Map<string, typeof questions.$inferSelect>();
  for (const question of ownedRows) byId.set(question.id, question);
  for (const row of bankRows) byId.set(row.question.id, row.question);
  const rows = [...byId.values()];
  const tagRows = rows.length
    ? await db.select().from(questionAudienceTags).where(inArray(questionAudienceTags.questionId, rows.map((row) => row.id)))
    : [];
  const tagsByQuestion = new Map<string, string[]>();
  for (const tag of tagRows) {
    tagsByQuestion.set(tag.questionId, [...(tagsByQuestion.get(tag.questionId) ?? []), tag.tag]);
  }

  return NextResponse.json({
    questions: rows.map((row) => toQuestionRecord(row, tagsByQuestion.get(row.id) ?? [])),
    count: rows.length,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const questionText = typeof body?.question_text === 'string' ? body.question_text.trim() : '';
  const answerText = typeof body?.answer_text === 'string' ? body.answer_text.trim() : '';
  const breadcrumbContext = typeof body?.breadcrumb_context === 'string' ? body.breadcrumb_context.trim() : '';
  if (!questionText || !answerText) {
    return NextResponse.json({ error: 'validation', message: 'question_text and answer_text are required' }, { status: 400 });
  }
  const breadcrumbError = validateBreadcrumbContext(breadcrumbContext);
  if (breadcrumbError) return NextResponse.json({ error: 'validation', message: breadcrumbError }, { status: 400 });

  const category = CATEGORIES.includes(body?.category as typeof CATEGORIES[number]) ? body?.category as typeof CATEGORIES[number] : 'other';
  const visibility = VISIBILITIES.includes(body?.visibility as typeof VISIBILITIES[number]) ? body?.visibility as typeof VISIBILITIES[number] : 'public';
  const questionType = QUESTION_TYPES.includes(body?.question_type as typeof QUESTION_TYPES[number]) ? body?.question_type as typeof QUESTION_TYPES[number] : 'factual';
  const difficultyEstimate = DIFFICULTIES.includes(body?.difficulty_estimate as typeof DIFFICULTIES[number]) ? body?.difficulty_estimate as typeof DIFFICULTIES[number] : null;
  const answerSource = ANSWER_SOURCES.includes(body?.answer_source as typeof ANSWER_SOURCES[number]) ? body?.answer_source as typeof ANSWER_SOURCES[number] : null;
  const tags = splitCsv(body?.tags).map((tag) => tag.toLowerCase()).slice(0, 10);
  const acceptedAlternatives = splitCsv(body?.accepted_alternatives);
  const categoryOverridden = typeof body?.category_overridden === 'boolean' ? body.category_overridden : false;

  const [created] = await db.insert(questions).values({
    creatorId: session.userId,
    questionText,
    answerText,
    breadcrumbContext,
    shortLabel: typeof body?.short_label === 'string' ? body.short_label.trim().slice(0, 80) || null : null,
    acceptedAlternatives,
    answerSource,
    questionType,
    difficultyEstimate,
    llmDifficulty: difficultyEstimate,
    calibratedDifficulty: difficultyEstimate,
    category,
    categoryOverridden,
    visibility,
    creatorNote: typeof body?.creator_note === 'string' ? body.creator_note.trim() || null : null,
  }).returning();

  if (tags.length) {
    await db.insert(questionAudienceTags).values(tags.map((tag) => ({ questionId: created.id, creatorId: session.userId, tag })));
  } else {
    void suggestTags(questionText, answerText, category).then(async (result) => {
      if (!result.tags.length) return;
      await db.insert(questionAudienceTags).values(result.tags.map((tag) => ({ questionId: created.id, creatorId: session.userId, tag }))).catch(() => undefined);
    });
  }

  if (!categoryOverridden) {
    void categorizeQuestion(questionText, answerText).then(async (result) => {
      await db.update(questions).set({
        broadCategory: result.broad_category,
        subcategory: result.subcategory,
        canonicalSubcategory: result.subcategory,
        updatedAt: new Date(),
      }).where(eq(questions.id, created.id)).catch(() => undefined);
    });
  }

  return NextResponse.json(toQuestionRecord(created, tags), { status: 201 });
}
