import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { addToBank, getBankedQuestions, removeFromBank } from '@/server/db/queries/bank';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  questionId: z.string().optional().catch(undefined),
  // Unrecognized context types / non-string contextId are coerced away rather
  // than rejected, matching the prior hand-rolled parser.
  contextType: z.enum(['feed', 'joshing_game', 'manual']).optional().catch(undefined),
  contextId: z.string().optional().catch(undefined),
});

function parseBody(value: unknown): z.infer<typeof bodySchema> | null {
  const parsed = bodySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function questionIdFrom(body: z.infer<typeof bodySchema> | null): string | null {
  return body && typeof body.questionId === 'string' && body.questionId.trim()
    ? body.questionId.trim()
    : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ questions: await getBankedQuestions(session.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = parseBody(await request.json().catch(() => null));
  const questionId = questionIdFrom(body);
  if (!questionId) return NextResponse.json({ error: 'validation', message: 'questionId is required' }, { status: 400 });

  const result = await addToBank({
    userId: session.userId,
    questionId,
    contextType: body?.contextType,
    contextId: body?.contextId,
  });

  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = parseBody(await request.json().catch(() => null));
  const questionId = questionIdFrom(body);
  if (!questionId) return NextResponse.json({ error: 'validation', message: 'questionId is required' }, { status: 400 });

  await removeFromBank(session.userId, questionId);
  return NextResponse.json({ ok: true });
}
