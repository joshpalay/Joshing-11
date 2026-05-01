import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getRatingCounts, getRatingForUser, setRating } from '@/server/db/queries/ratings';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseRating(value: unknown): 'up' | 'down' | null | undefined {
  if (value === null || value === 'up' || value === 'down') return value;
  return undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const [myRating, counts] = await Promise.all([
    getRatingForUser(session.userId, id),
    getRatingCounts(id),
  ]);

  return NextResponse.json({ myRating, counts });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { rating?: unknown } | null;
  const rating = parseRating(body?.rating);
  if (rating === undefined) {
    return NextResponse.json({ error: 'rating must be up, down, or null' }, { status: 400 });
  }

  const { id } = await context.params;
  await setRating(session.userId, id, rating);

  return NextResponse.json({ ok: true });
}
