/**
 * Permanent per-question hide + its undo — the "Never show this question again"
 * scope of the Not-for-me sheet.
 *
 * POST   { question_id? , generated_question_id?, domain }  → hide
 * DELETE { hidden_id }                                      → restore (undo)
 *
 * The other two scopes behind that same sheet already had endpoints and are NOT
 * duplicated here: "Skip for now" is POST /api/daily/skip, and "Rest this
 * category" is POST /api/daily/preferences/domain-frequency. This route owns
 * only the durable per-question refusal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { hideQuestion, restoreHiddenQuestion } from '@/server/db/queries/hidden-questions';

export const dynamic = 'force-dynamic';

const hideSchema = z
  .object({
    question_id: z.string().min(1).optional(),
    generated_question_id: z.string().min(1).optional(),
    domain: z.string().min(1),
  })
  // A hide has to name exactly one question in exactly one id space; accepting
  // both would write a row that two different lookups could claim.
  .refine(
    (value) => Boolean(value.question_id) !== Boolean(value.generated_question_id),
    { message: 'exactly one of question_id or generated_question_id is required' },
  );

const restoreSchema = z.object({ hidden_id: z.string().min(1) });

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = hideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid body' },
      { status: 400 },
    );
  }

  await hideQuestion({
    userId: session.userId,
    questionId: parsed.data.question_id ?? null,
    generatedQuestionId: parsed.data.generated_question_id ?? null,
    canonicalSubcategory: parsed.data.domain,
  });

  return NextResponse.json({ hidden: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: 'hidden_id is required' },
      { status: 400 },
    );
  }

  // Scoped to the session user inside the query, so an id belonging to someone
  // else simply reports not-found rather than clearing their row.
  const restored = await restoreHiddenQuestion(session.userId, parsed.data.hidden_id);
  if (!restored) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ restored: true });
}
