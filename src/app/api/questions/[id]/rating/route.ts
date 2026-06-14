import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { getRatingCounts, getRatingForUser, setRating } from '@/server/db/queries/ratings';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Up-only: the thumbs-down UI was retired for the structured content-report flow.
// 'down' is no longer an accepted write (historical 'down' rows are still read).
const bodySchema = z.object({
  rating: z.union([z.literal('up'), z.null()]),
});

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'rating must be up or null' }, { status: 400 });
  }

  const { id } = await context.params;
  await setRating(session.userId, id, parsed.data.rating);

  return NextResponse.json({ ok: true });
}
