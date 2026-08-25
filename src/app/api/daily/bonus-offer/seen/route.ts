import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { markBonusOfferSeen } from '@/server/daily/bonus-offer';

export const dynamic = 'force-dynamic';

// B-BONUS-OFFER-01: persist the seen-signal so the friend-bonus interstitial never
// fires again. Called on BOTH resolutions ("Keep going" and "No thanks") — the
// player has been told what the +2 is either way. Idempotent on the server.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await markBonusOfferSeen(session.userId);
  return NextResponse.json({ ok: true });
}
