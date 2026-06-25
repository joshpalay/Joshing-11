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
  // B3 provenance note: suggestion output is DELIBERATELY not stamped. It is a
  // fully-ephemeral compose-time writer aid — this response is returned to the
  // client and never persisted as its own row. If the author adopts the
  // suggested answer and creates the question, that question's provenance is
  // captured by the categorize stamp (Question.categorize_provider), which is
  // the durable signal. A dedicated llm_suggestion_log would only add noise for
  // a call whose output usually never lands, so we capture nothing here (PRD B3,
  // step 3 — judgment call, documented).
  return NextResponse.json(await suggestAnswer(question, suggestProvider));
}
