import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { suggestAnswer } from '@/lib/llm';
import { getSession } from '@/server/auth/session';
import { getProviderSettings } from '@/server/llm/settings';

const bodySchema = z.object({ question: z.string() });

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const question = parsed.success ? parsed.data.question.trim() : '';
  if (question.length < 5) return NextResponse.json({ error: 'question too short' }, { status: 400 });

  // B-LLM-PROVIDER-AB-SWITCH B2: use the globally-selected suggest provider.
  const suggestProvider = (await getProviderSettings()).suggest;
  return NextResponse.json(await suggestAnswer(question, suggestProvider));
}
