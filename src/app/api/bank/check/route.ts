import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { checkBankedQuestions } from '@/server/db/queries/bank';

export const dynamic = 'force-dynamic';

// Tolerant of a missing/non-array body and of non-string elements (which are
// filtered out, matching the prior hand-rolled parser) rather than 400-ing.
const bodySchema = z.object({
  questionIds: z.array(z.unknown()).optional().catch(undefined),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const questionIds = (parsed.success ? parsed.data.questionIds ?? [] : []).filter(
    (id): id is string => typeof id === 'string',
  );

  return NextResponse.json(await checkBankedQuestions(session.userId, questionIds));
}
