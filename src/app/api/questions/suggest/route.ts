import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { suggestQuestionAnswer } from '@/server/llm/suggest-question';
import { getDailyLlmUsageCount, incrementDailyLlmUsage } from '@/server/llm/rate-limit';

const bodySchema = z.object({ questionText: z.string() });

// Generate (+ verify, + possible regenerate) an answer for a question the
// user is composing. The most expensive call in the create-a-question flow,
// so it gets the same daily-cap treatment as /api/questions/critique.
const DAILY_LIMIT = 15;
const ACTION = 'suggest-answer';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const questionText = parsed.success ? parsed.data.questionText.trim() : '';
  if (!questionText) return NextResponse.json({ error: 'questionText is required' }, { status: 400 });

  const usageCount = await getDailyLlmUsageCount(session.userId, ACTION);
  if (usageCount >= DAILY_LIMIT) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const suggestion = await suggestQuestionAnswer(questionText);
    await incrementDailyLlmUsage(session.userId, ACTION, DAILY_LIMIT);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'Suggestion unavailable.' }, { status: 500 });
  }
}
