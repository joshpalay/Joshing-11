import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, generatedQuestions, questionFeedback, questions } from '@/server/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  question_id: z.string().optional().catch(undefined),
  generated_question_id: z.string().optional().catch(undefined),
  // null clears a previously recorded signal (un-react); omit/garbage is treated
  // the same as an explicit clear via the .catch below.
  signal: z.enum(['thumbs_up', 'thumbs_down']).nullable().optional().catch(null),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const body = parsed.success ? parsed.data : null;

  const questionId = typeof body?.question_id === 'string' && body.question_id ? body.question_id : null;
  const generatedQuestionId = typeof body?.generated_question_id === 'string' && body.generated_question_id
    ? body.generated_question_id
    : null;
  // A null signal is a valid request: it clears any feedback the user
  // previously recorded for this question (the heart un-react path).
  const signal = body?.signal ?? null;

  if ((questionId && generatedQuestionId) || (!questionId && !generatedQuestionId)) {
    return NextResponse.json(
      { error: 'validation', message: 'exactly one of question_id or generated_question_id is required' },
      { status: 400 },
    );
  }

  if (questionId) {
    const [question] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);
    if (!question) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (signal) {
      await db
        .insert(questionFeedback)
        .values({ userId: session.userId, questionId, generatedQuestionId: null, signal })
        .onConflictDoUpdate({
          target: [questionFeedback.userId, questionFeedback.questionId],
          set: { signal, createdAt: new Date() },
        });
    } else {
      await db
        .delete(questionFeedback)
        .where(and(
          eq(questionFeedback.userId, session.userId),
          eq(questionFeedback.questionId, questionId),
          isNull(questionFeedback.generatedQuestionId),
        ));
    }
  }

  if (generatedQuestionId) {
    const [generated] = await db
      .select({ id: generatedQuestions.id })
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.id, generatedQuestionId),
        eq(generatedQuestions.userId, session.userId),
      ))
      .limit(1);
    if (!generated) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (signal) {
      await db
        .insert(questionFeedback)
        .values({ userId: session.userId, questionId: null, generatedQuestionId, signal })
        .onConflictDoUpdate({
          target: [questionFeedback.userId, questionFeedback.generatedQuestionId],
          set: { signal, createdAt: new Date() },
        });
    } else {
      await db
        .delete(questionFeedback)
        .where(and(
          eq(questionFeedback.userId, session.userId),
          eq(questionFeedback.generatedQuestionId, generatedQuestionId),
          isNull(questionFeedback.questionId),
        ));
    }
  }

  return NextResponse.json({ ok: true });
}
