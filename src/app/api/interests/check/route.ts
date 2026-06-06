import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import { assessInterestAnswerability } from '@/server/llm/interests';

// Inline Haiku call; keep a modest budget above the default so a slow check
// completes rather than being platform-killed.
export const maxDuration = 30;

const bodySchema = z.object({
  topic: z.string().trim().min(1).max(100),
});

// Up-front validation for a typed declared interest, used by surfaces that stage
// a topic client-side before the batch save (onboarding) or before opening a
// confirm step (the knowledge "use my wording" path). Mirrors the two write-path
// guards: too-broad (expand into specifics) and unanswerable (no factual basis).
// Answerability fails open inside assessInterestAnswerability, so an LLM outage
// returns ok and never blocks a real user.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter a topic (up to 100 characters).' },
      { status: 400 },
    );
  }

  const topic = parsed.data.topic;

  if (isTooBroadInterest(topic)) {
    return NextResponse.json({
      ok: false,
      code: 'too_broad',
      message: `"${topic}" is a whole category. Pick something more specific within it.`,
    });
  }

  const answerability = await assessInterestAnswerability(topic);
  if (!answerability.answerable) {
    return NextResponse.json({
      ok: false,
      code: 'unanswerable',
      message: answerability.reason,
    });
  }

  return NextResponse.json({ ok: true });
}
