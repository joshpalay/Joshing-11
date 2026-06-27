import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getRecoveredGradingQuestion } from '@/server/db/queries/recovered-questions';
import { gradeAnswer } from '@/server/grading';

/**
 * D-REVIEW-RECOVERED-01 (Decision B) — graded, NON-persisting review submission.
 *
 * This route grades a typed answer for real (the same `gradeAnswer` the live
 * surfaces use) so the reveal is honest, then returns the verdict and STOPS.
 * It runs none of the persistence tail: deliberately imports neither
 * `writeMasteryEvent` nor `deriveAnswerOutcome`, writes no `mastery_events`
 * row, fans out nothing, and touches the mastery system in no direction. The
 * read-only contract of the surface is preserved here, at the line the doc
 * draws: grading is fine; persisting the grade is not.
 *
 * The question is loaded through `getRecoveredGradingQuestion`, whose inner
 * join is the pool-membership guard — you can only review what you recovered.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'questionId and answer are required' },
      { status: 400 },
    );
  }

  const question = await getRecoveredGradingQuestion(session.userId, parsed.data.questionId);
  // Not in the viewer's recovered pool (or never existed) — nothing to review.
  if (!question) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const grade = await gradeAnswer(
    parsed.data.answer,
    question.answerText,
    question.acceptedAlternatives,
    question.questionText,
    question.questionType,
  );

  // Fail toward the player: a grader outage is an infra event, not a verdict.
  // Mirror the live "hold for retry" branch — NEVER render an unscored grade as
  // a wrong answer. The response carries no `isCorrect`, so the UI cannot show
  // a miss; it surfaces the retry message instead.
  if (grade.status === 'unscored') {
    return NextResponse.json(
      {
        error: 'grader_unavailable',
        message:
          "Our answer-checker is taking a quick breather. Your answer wasn't scored — give it another go in a moment.",
      },
      { status: 503 },
    );
  }

  // Scored verdict — return it and discard. No persistence, no mastery write.
  return NextResponse.json({
    isCorrect: grade.result === 'correct',
    consolation: grade.consolation,
    correctAnswer: question.answerText,
    explanation: question.explanation,
    creatorNote: question.creatorNote,
  });
}
