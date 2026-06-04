import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { suggestQuestionAnswer } from '@/server/llm/suggest-question';

const bodySchema = z.object({ questionText: z.string() });

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const questionText = parsed.success ? parsed.data.questionText.trim() : '';
  if (!questionText) return NextResponse.json({ error: 'questionText is required' }, { status: 400 });

  try {
    const suggestion = await suggestQuestionAnswer(questionText);
    return NextResponse.json(suggestion);
  } catch {
    return NextResponse.json({ error: 'Suggestion unavailable.' }, { status: 500 });
  }
}
