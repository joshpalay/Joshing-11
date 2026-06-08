import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markFirstSessionRecapSeen } from '@/server/daily/get-first-session-recap';

export const dynamic = 'force-dynamic';

// B-FirstRecap-1: persist the seen-signal so the recap never fires again. Called
// when the recap is first shown; idempotent on the server.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await markFirstSessionRecapSeen(session.userId);
  return NextResponse.json({ ok: true });
}
