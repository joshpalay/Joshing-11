import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getJoshingGame } from '@/server/db/queries/joshing-game';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function canViewGame(view: Awaited<ReturnType<typeof getJoshingGame>>, userId: string): boolean {
  return Boolean(
    view &&
    (view.game.creatorId === userId ||
      view.recipients.some((recipient) => recipient.userId === userId)),
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const view = await getJoshingGame({ gameId: id, requestingUserId: session.userId });
  if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canViewGame(view, session.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json(view);
}
