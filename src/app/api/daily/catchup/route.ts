import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getCatchupQuestions } from '@/server/db/queries/daily';
import { formatCatchUpSessionThreadIntro } from '@/server/play/catch-up-copy';
import { catchUpErrorResponse } from '@/server/play/catch-up-submit-error';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return catchUpErrorResponse(401, 'unauthorized');

  const items = await getCatchupQuestions(session.userId);
  const first = items[0];
  const last = items[items.length - 1];
  return NextResponse.json({
    items: items.map((item) => ({
      dailyQueueItemId: item.dailyQueueItemId,
      questionId: item.questionId,
      questionText: item.questionText,
      correctAnswer: item.correctAnswer,
      alternateAnswers: item.alternateAnswers,
      explanation: item.explanation,
      domain: item.domain,
      domainDisplayName: item.domainDisplayName,
      queueDate: item.queueDate,
      queueAge: item.queueAge,
      wasSkipped: item.wasSkipped,
      expiresAt: item.expiresAt,
      expiresSoon: item.expiresSoon,
    })),
    introCopy: first
      ? formatCatchUpSessionThreadIntro(items.length, first.queueDate, last?.queueDate)
      : '',
    count: items.length,
  });
}
