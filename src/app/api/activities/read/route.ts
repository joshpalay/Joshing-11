import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markAllRead } from '@/server/db/queries/activity';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await markAllRead(session.userId);
  return NextResponse.json({ ok: true });
}
