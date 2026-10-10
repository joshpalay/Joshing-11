import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { dismissAcceptedRequests } from '@/server/db/queries/activity';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  activityIds: z.array(z.string().min(1)).min(1).max(50),
});

// "Got it" on the home "said yes" card: marks those follow_approved rows read.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Missing or invalid request body.' },
      { status: 400 },
    );
  }

  await dismissAcceptedRequests(session.userId, parsed.data.activityIds);
  return NextResponse.json({ ok: true });
}
