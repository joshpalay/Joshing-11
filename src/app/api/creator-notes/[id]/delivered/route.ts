import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markCreatorNoteDelivered } from '@/server/creator-notes';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  await markCreatorNoteDelivered(id, session.userId);
  return NextResponse.json({ ok: true });
}
