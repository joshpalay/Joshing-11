import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  dismissMilestoneQuestion,
  getSeededPlayQuestions,
  reinstateMilestoneQuestion,
} from '@/server/db/queries/lately';

/**
 * Dismiss (POST) or undo-dismiss (DELETE) a From Friends milestone question.
 *
 * "Dismiss-as-answered": waving a friend's milestone question off consumes it —
 * it counts toward the bundle's played progress and, once every question in a
 * bundle is answered-or-dismissed, the bundle disappears (build-stream drops it
 * on the next load). But it is deliberately NEUTRAL: unlike the answer route
 * (and unlike "View Answer", which persists a give-up MISS), this writes ONLY
 * the MilestoneDismissed row and touches nothing in the mastery/points system,
 * so a dismiss never reads as a wrong answer.
 *
 * Authorization is by construction, mirroring the milestone answer route:
 * getSeededPlayQuestions only resolves questions that appear in THIS viewer's
 * own derived From Friends milestones, so a tampered id resolves to nothing and
 * 404s here.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ questionId: z.string().trim().min(1) });

async function authorizeQuestionId(request: NextRequest, userId: string): Promise<
  { ok: true; questionId: string } | { ok: false; response: NextResponse }
> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'validation', message: 'questionId is required' },
        { status: 400 },
      ),
    };
  }
  const [authorized] = await getSeededPlayQuestions(userId, [parsed.data.questionId]);
  if (!authorized) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'not_found', message: 'Question not available' },
        { status: 404 },
      ),
    };
  }
  return { ok: true, questionId: parsed.data.questionId };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const auth = await authorizeQuestionId(request, session.userId);
  if (!auth.ok) return auth.response;

  await dismissMilestoneQuestion(session.userId, auth.questionId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const auth = await authorizeQuestionId(request, session.userId);
  if (!auth.ok) return auth.response;

  await reinstateMilestoneQuestion(session.userId, auth.questionId);
  return NextResponse.json({ ok: true });
}
