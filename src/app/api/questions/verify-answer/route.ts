import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { verifyAnswer } from '@/server/llm/suggest-question';

// On-demand answer fact-check. Surfaces where a human edits a proposed answer
// (e.g. the crafter keep/kill cards) call this to confirm the edited answer is
// correct for the question before committing it. Fail-open by design: verifyAnswer
// returns UNVERIFIABLE rather than throwing when the LLM is unavailable.
const bodySchema = z.object({
  questionText: z.string().trim().min(1).max(600),
  answer: z.string().trim().min(1).max(400),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'questionText and answer are required' }, { status: 400 });
  }

  try {
    const verdict = await verifyAnswer(parsed.data.questionText, parsed.data.answer);
    return NextResponse.json({ verdict: verdict.verdict, correctedAnswer: verdict.correctedAnswer });
  } catch {
    return NextResponse.json({ error: 'Verification unavailable.' }, { status: 500 });
  }
}
