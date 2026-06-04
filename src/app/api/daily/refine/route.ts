import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { dailyQueues, dailyRefineDecisions, db } from '@/server/db';
import { deriveSelectedRefineCandidates } from '@/server/db/queries/refine';
import type { QueueSlot } from '@/server/daily/types';
import { refineItemKey } from '@/server/refine/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  queue_id: z.string().trim().min(1),
  item_type: z.enum(['friend_expansion', 'difficulty_escalation', 'struggle_pruning']),
  canonical_subcategory: z.string().trim().min(1),
  friend_id: z.string().trim().min(1).optional(),
});

type RefineBody = z.infer<typeof bodySchema>;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

async function parseBody(request: NextRequest): Promise<RefineBody | null> {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Resolve: stage a refine decision (action verb tapped). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  // The queue must belong to the caller.
  const [queue] = await db
    .select({ id: dailyQueues.id, slots: dailyQueues.slots })
    .from(dailyQueues)
    .where(and(eq(dailyQueues.id, body.queue_id), eq(dailyQueues.userId, session.userId)))
    .limit(1);
  if (!queue) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Never trust the client about which items are real — re-derive and confirm.
  const candidates = await deriveSelectedRefineCandidates(session.userId, asQueueSlots(queue.slots));
  const targetKey = refineItemKey(body.item_type, body.canonical_subcategory, body.friend_id);
  const match = candidates.find(
    (candidate) => refineItemKey(candidate.type, candidate.subdomainId, candidate.friendId) === targetKey,
  );
  if (!match) {
    return NextResponse.json({ error: 'stale_item' }, { status: 409 });
  }

  // Upsert against the COALESCE(friend_id,'') unique index — re-tapping is a no-op
  // that simply re-stages (clears any prior commit/cooldown stamp).
  await db.execute(sql`
    INSERT INTO "DAILY_REFINE_DECISION"
      ("user_id", "queue_id", "item_type", "canonical_subcategory", "friend_id", "action")
    VALUES (
      ${session.userId}, ${queue.id}, ${match.type}, ${match.subdomainId},
      ${match.friendId ?? null}, 'pending'
    )
    ON CONFLICT ("user_id", "queue_id", "item_type", "canonical_subcategory", COALESCE("friend_id", ''))
    DO UPDATE SET "action" = 'pending', "committed_at" = NULL, "cooldown_until" = NULL, "updated_at" = now()
  `);

  return NextResponse.json({ ok: true });
}

/** Undo: unstage a decision, allowed only while it hasn't committed. */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  const [row] = await db
    .select({ id: dailyRefineDecisions.id, committedAt: dailyRefineDecisions.committedAt })
    .from(dailyRefineDecisions)
    .where(and(
      eq(dailyRefineDecisions.userId, session.userId),
      eq(dailyRefineDecisions.queueId, body.queue_id),
      eq(dailyRefineDecisions.itemType, body.item_type),
      eq(dailyRefineDecisions.canonicalSubcategory, body.canonical_subcategory),
      body.friend_id
        ? eq(dailyRefineDecisions.friendId, body.friend_id)
        : isNull(dailyRefineDecisions.friendId),
    ))
    .limit(1);

  if (!row) return NextResponse.json({ ok: true });
  if (row.committedAt) {
    // The next daily already committed this change — undo window is over.
    return NextResponse.json({ error: 'already_committed' }, { status: 409 });
  }

  await db.delete(dailyRefineDecisions).where(eq(dailyRefineDecisions.id, row.id));
  return NextResponse.json({ ok: true });
}
