import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  getActiveInvitations,
  getUnseenInvitation,
  markInvitationSeen,
  recordDoorChoice,
} from '@/server/db/queries/author-invitations';

export const dynamic = 'force-dynamic';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the player side of author invitations.
// GET: is there an unseen invitation (drives the one-time post-daily takeover
//      redirect) + the full active list (the quiet, revisitable state).
// POST seen: the takeover rendered — stamp seenAt so it NEVER takes over again
//      (once-then-quiet; no streaks, no re-engagement pressure).
// POST door: record which door the player took (author / expand / wait). 'wait'
//      is a genuine subscription marker, nothing more.

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seen'), invitationId: z.string().trim().min(1) }),
  z.object({
    action: z.literal('door'),
    invitationId: z.string().trim().min(1),
    choice: z.enum(['author', 'expand', 'wait']),
  }),
]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [unseen, active] = await Promise.all([
    getUnseenInvitation(session.userId),
    getActiveInvitations(session.userId),
  ]);
  return NextResponse.json({ unseen, active });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }
  const data = parsed.data;

  if (data.action === 'seen') {
    await markInvitationSeen(session.userId, data.invitationId);
    return NextResponse.json({ ok: true });
  }

  await recordDoorChoice(session.userId, data.invitationId, data.choice);
  return NextResponse.json({ ok: true });
}
