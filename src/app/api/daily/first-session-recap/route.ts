import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getFirstSessionRecap } from '@/server/daily/get-first-session-recap';

export const dynamic = 'force-dynamic';

// B-FirstRecap-1: returns the one-time first-session recap after the user's
// first completed Daily Five, or { recap: null } when it must not fire.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const recap = await getFirstSessionRecap(session.userId);
  return NextResponse.json({ recap });
}
