import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getFirstGameRecap } from '@/server/games/get-first-game-recap';

export const dynamic = 'force-dynamic';

// B-FirstGameRecap-1: returns the one-time first-game recap after the user's
// first completed Joshing game, or { recap: null } when it must not fire.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get('gameId');
  if (!gameId) {
    return NextResponse.json({ error: 'game_id_required' }, { status: 400 });
  }

  const recap = await getFirstGameRecap({ userId: session.userId, gameId });
  return NextResponse.json({ recap });
}
