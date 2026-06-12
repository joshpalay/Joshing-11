import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markFirstGameRecapSeen } from '@/server/games/get-first-game-recap';

export const dynamic = 'force-dynamic';

// B-FirstGameRecap-1: persist the seen-signal so the first-game recap never
// fires again. Called when the recap is first shown; idempotent on the server.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await markFirstGameRecapSeen(session.userId);
  return NextResponse.json({ ok: true });
}
