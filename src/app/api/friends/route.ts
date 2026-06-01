import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getFriendsHub } from '@/server/db/queries/friends';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const hub = await getFriendsHub(session.userId);

  return NextResponse.json({ ok: true, ...hub });
}
