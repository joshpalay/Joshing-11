import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markActivityBellOpened } from '@/server/db/queries/activity';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await markActivityBellOpened(session.userId);
  return NextResponse.json({ ok: true });
}
