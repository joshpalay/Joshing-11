import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  countContentReportsToday,
  insertContentReport,
} from '@/server/db/queries/content-reports';

export const dynamic = 'force-dynamic';

// B-Report-2: the player's negative surface. A reporter opens the existing ⋯ on a
// post-reveal review surface, picks "This is incorrect" / "This is inappropriate",
// answers a short shaped "why", and lands a ContentReport row. No suppression /
// author surfacing / admin queue yet — this only captures the report.

// §6.2.1 flood-stop. At or over the cap we soft-429 (the report is not written) so a
// single frustrated session can't bury the queue. The client shows a gentle nudge.
const DAILY_REPORT_CAP = 10;

const target = {
  questionId: z.string().trim().min(1).optional(),
  generatedQuestionId: z.string().trim().min(1).optional(),
};

// "incorrect": which part is wrong (incorrectKind), a required note, and an optional
// "the answer should be ___" (suggestedAnswer).
const incorrectSchema = z.object({
  category: z.literal('incorrect'),
  incorrectKind: z.enum(['answer_key', 'premise']),
  note: z.string().trim().min(1),
  suggestedAnswer: z.string().trim().min(1).optional(),
  surface: z.enum(['round_recap', 'lately_result', 'answered_list', 'feed', 'catchup_thread', 'recovered']),
  ...target,
});

// "inappropriate": a required note only. incorrectKind / suggestedAnswer are not
// meaningful here and are rejected so the ContentReport_incorrect_kind_scope CHECK
// (incorrect_kind only when category='incorrect') can never be violated.
const inappropriateSchema = z.object({
  category: z.literal('inappropriate'),
  incorrectKind: z.undefined().optional(),
  suggestedAnswer: z.undefined().optional(),
  note: z.string().trim().min(1),
  surface: z.enum(['round_recap', 'lately_result', 'answered_list', 'feed', 'catchup_thread', 'recovered']),
  ...target,
});

const bodySchema = z
  .discriminatedUnion('category', [incorrectSchema, inappropriateSchema])
  // Exactly one target — the dual-FK invariant the ContentReport_one_target CHECK
  // also enforces. Reject a generated id smuggled in alongside a curated one.
  .refine(
    (data) => (data.questionId ? 1 : 0) + (data.generatedQuestionId ? 1 : 0) === 1,
    { message: 'exactly one of questionId or generatedQuestionId is required' },
  );

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid report' },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Flood-stop runs before the insert so an over-cap report never lands.
  const todayCount = await countContentReportsToday(session.userId);
  if (todayCount >= DAILY_REPORT_CAP) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: "You've sent us a lot today. Take a break — you can pick this back up tomorrow.",
      },
      { status: 429 },
    );
  }

  const result = await insertContentReport({
    reporterUserId: session.userId,
    questionId: data.questionId ?? null,
    generatedQuestionId: data.generatedQuestionId ?? null,
    category: data.category,
    incorrectKind: data.category === 'incorrect' ? data.incorrectKind : null,
    suggestedAnswer: data.category === 'incorrect' ? data.suggestedAnswer ?? null : null,
    note: data.note,
    surface: data.surface,
  });

  // 'duplicate' = an open report for this target already exists (one-open-report
  // partial unique index). Idempotent: the player gets the same quiet success.
  return NextResponse.json({ ok: true, duplicate: result === 'duplicate' });
}
