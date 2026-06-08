import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, generatedQuestions, questionFeedback, questions } from '@/server/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  question_id: z.string().optional().catch(undefined),
  generated_question_id: z.string().optional().catch(undefined),
  signal: z.enum(['thumbs_up', 'thumbs_down']).optional().catch(undefined),
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
  const signal = body?.signal ?? null;

  if (!signal) {
    return NextResponse.json(
      { error: 'validation', message: 'signal must be thumbs_up or thumbs_down' },
      { status: 400 },
    );
  }
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

    await db
      .insert(questionFeedback)
      .values({ userId: session.userId, questionId, generatedQuestionId: null, signal })
      .onConflictDoUpdate({
        target: [questionFeedback.userId, questionFeedback.questionId],
        set: { signal, createdAt: new Date() },
      });
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

    await db
      .insert(questionFeedback)
      .values({ userId: session.userId, questionId: null, generatedQuestionId, signal })
      .onConflictDoUpdate({
        target: [questionFeedback.userId, questionFeedback.generatedQuestionId],
        set: { signal, createdAt: new Date() },
      });
  }

  return NextResponse.json({ ok: true });
}
