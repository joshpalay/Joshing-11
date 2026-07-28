import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { critiqueQuestion } from '@/server/llm/critique';
import { getDailyLlmUsageCount, incrementDailyLlmUsage } from '@/server/llm/rate-limit';

export const dynamic = 'force-dynamic';

const DAILY_LIMIT = 5;
const ACTION = 'critique';

const bodySchema = z.object({ questionText: z.string().optional().catch(undefined) });

type CritiqueResponse = {
  ok: boolean;
  issues?: string[];
  reformulations?: string[];
  limitReached: boolean;
  remaining: number | null;
};

function passResponse(extra: Partial<CritiqueResponse> = {}): CritiqueResponse {
  return { ok: true, limitReached: false, remaining: null, ...extra };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    const questionText = parsed.success && typeof parsed.data.questionText === 'string'
      ? parsed.data.questionText.trim()
      : '';
    if (!questionText) return NextResponse.json(passResponse({ remaining: null }));

    const usageCount = await getDailyLlmUsageCount(session.userId, ACTION);
    if (usageCount >= DAILY_LIMIT) {
      return NextResponse.json(passResponse({ limitReached: true, remaining: 0 }));
    }

    const critiqueResult = await critiqueQuestion({ questionText });

    const { ok, count } = await incrementDailyLlmUsage(session.userId, ACTION, DAILY_LIMIT);
    if (!ok) {
      return NextResponse.json(passResponse({ limitReached: true, remaining: 0 }));
    }

    return NextResponse.json({
      ...critiqueResult,
      limitReached: false,
      remaining: Math.max(DAILY_LIMIT - count, 0),
    } satisfies CritiqueResponse);
  } catch (error) {
    console.warn('[api/questions/critique] fail_open', error);
    return NextResponse.json(passResponse());
  }
}
