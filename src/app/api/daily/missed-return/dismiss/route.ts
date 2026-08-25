import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  dismissMissedReturn,
  reinstateMissedReturn,
} from '@/server/db/queries/missed-return-dismissed';

export const dynamic = 'force-dynamic';

/**
 * D-MISSED-RETURN-01 §7-C — per-row dismiss from the Customize list, with the
 * immediate-undo affordance.
 *
 * DELETE is the undo. §7-C revised the decision away from the siblings'
 * reversible-forever archive: the undo window is a few seconds on the client and
 * then it's final, and NO browsable dismissed shelf is built on top of it. The
 * underlying row keeps `reinstatedAt` because the shipped catch-up undismiss
 * route also needs a reversal path — same mechanism, different window.
 *
 * A dismiss here is NEUTRAL (§5): it writes one row and touches no mastery or
 * points state, so it can never read as a wrong answer.
 */
// `kind` names which table the id belongs to. It defaults to 'canonical' so the
// catch-up dual-write callers (which only ever hold canonical ids) keep working
// unchanged, but the Customize list always sends it explicitly — the Daily Five
// serves LLM-generated questions too, and those are most of what gets missed.
const bodySchema = z.object({
  questionId: z.string().min(1),
  kind: z.enum(['canonical', 'generated']).default('canonical'),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'questionId is required' }, { status: 400 });
  }

  await dismissMissedReturn(session.userId, parsed.data.questionId, parsed.data.kind);
  return NextResponse.json({ dismissed: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'questionId is required' }, { status: 400 });
  }

  await reinstateMissedReturn(session.userId, parsed.data.questionId, parsed.data.kind);
  return NextResponse.json({ restored: true });
}
