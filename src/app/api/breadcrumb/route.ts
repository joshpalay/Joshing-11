import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { asQueueSlots, findQueueSlotBySlotIndex, replaceQueueSlot } from '@/server/daily/catchup';
import { generateBreadcrumb } from '@/server/daily/generate-breadcrumb';
import {
  dailyQueues,
  db,
  joshingGameRecipients,
  joshingGameResponses,
  joshingGames,
  questions,
} from '@/server/db';

export const dynamic = 'force-dynamic';

const dailyBodySchema = z.object({
  source: z.literal('daily'),
  queueId: z.string().min(1),
  slotIndex: z.number().int().nonnegative(),
});

const joshingGameBodySchema = z.object({
  source: z.literal('joshing_game'),
  gameId: z.string().min(1),
  questionId: z.string().min(1),
});

const bodySchema = z.discriminatedUnion('source', [dailyBodySchema, joshingGameBodySchema]);

type ParsedBody = z.infer<typeof bodySchema>;

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message, breadcrumb: null }, { status });
}

async function handleDaily(userId: string, body: z.infer<typeof dailyBodySchema>) {
  const [queue] = await db
    .select()
    .from(dailyQueues)
    .where(and(eq(dailyQueues.id, body.queueId), eq(dailyQueues.userId, userId)))
    .limit(1);
  if (!queue) return errorResponse(404, 'not_found', 'Queue not found.');

  const slots = asQueueSlots(queue.slots);
  const slot = findQueueSlotBySlotIndex(slots, body.slotIndex);
  if (!slot) return errorResponse(404, 'not_found', 'Slot not found.');
  if (!slot.answered) return errorResponse(400, 'invalid_state', 'Slot is not answered yet.');

  if (slot.reveal_breadcrumb) {
    return NextResponse.json({ breadcrumb: slot.reveal_breadcrumb });
  }

  const isCorrect = slot.answer_state === 'correct';
  const correctAnswer = slot.reveal_canonical_answer ?? '';
  const submittedAnswer = slot.submitted_answer ?? '';

  // Mirrors the gaveUp short-circuit in src/app/api/daily/answer/route.ts —
  // no breadcrumb when the player gave up.
  if (!isCorrect && !submittedAnswer) {
    return NextResponse.json({ breadcrumb: null });
  }

  const breadcrumb = await generateBreadcrumb({
    questionId: slot.generated_question_id ?? slot.question_id,
    questionText: slot.question_text,
    correctAnswer,
    submittedAnswer,
    isCorrect,
    domain: slot.domain,
  }).catch(() => null);

  if (breadcrumb) {
    const nextSlots = replaceQueueSlot(slots, body.slotIndex, (item) => ({
      ...item,
      reveal_breadcrumb: breadcrumb,
    }));
    await db
      .update(dailyQueues)
      .set({ slots: nextSlots })
      .where(eq(dailyQueues.id, queue.id))
      .catch((err) => {
        console.warn('[breadcrumb] failed to persist breadcrumb to slot', err);
      });
  }

  return NextResponse.json({ breadcrumb });
}

async function handleJoshingGame(userId: string, body: z.infer<typeof joshingGameBodySchema>) {
  const [game] = await db
    .select({ creatorId: joshingGames.creatorId })
    .from(joshingGames)
    .where(eq(joshingGames.id, body.gameId))
    .limit(1);
  if (!game) return errorResponse(404, 'not_found', 'Game not found.');

  if (game.creatorId !== userId) {
    const [recipient] = await db
      .select({ id: joshingGameRecipients.id })
      .from(joshingGameRecipients)
      .where(and(eq(joshingGameRecipients.gameId, body.gameId), eq(joshingGameRecipients.userId, userId)))
      .limit(1);
    if (!recipient) return errorResponse(403, 'forbidden', 'Not a participant of this game.');
  }

  const [row] = await db
    .select({
      response: joshingGameResponses,
      question: questions,
    })
    .from(joshingGameResponses)
    .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
    .where(and(
      eq(joshingGameResponses.gameId, body.gameId),
      eq(joshingGameResponses.questionId, body.questionId),
      eq(joshingGameResponses.userId, userId),
    ))
    .limit(1);

  if (!row) return errorResponse(404, 'not_found', 'No answer recorded for that question.');
  if (row.response.isCorrect === null) {
    return NextResponse.json({ breadcrumb: null });
  }

  const isCorrect = Boolean(row.response.isCorrect);
  const submittedAnswer = row.response.submittedAnswer ?? '';
  if (!isCorrect && !submittedAnswer) {
    return NextResponse.json({ breadcrumb: null });
  }
  const domain = row.question.canonicalSubcategory || row.question.broadCategory || row.question.category;

  const breadcrumb = await generateBreadcrumb({
    questionId: row.question.id,
    questionText: row.question.questionText,
    correctAnswer: row.question.answerText,
    submittedAnswer,
    isCorrect,
    domain,
  }).catch(() => null);

  return NextResponse.json({ breadcrumb });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return errorResponse(401, 'unauthorized', 'Please sign in.');

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, 'validation', 'Invalid breadcrumb request.');

    const body: ParsedBody = parsed.data;
    if (body.source === 'daily') return handleDaily(session.userId, body);
    return handleJoshingGame(session.userId, body);
  } catch (error) {
    console.error('[breadcrumb] unexpected failure', error);
    return errorResponse(500, 'unexpected', 'Could not generate a breadcrumb.');
  }
}
