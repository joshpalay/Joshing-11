import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import {
  getDiscoverability,
  updateDiscoverability,
} from '@/server/db/queries/account';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    contacts: z.boolean().optional(),
    mutualFriends: z.boolean().optional(),
    nicheMatch: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.contacts !== undefined
      || b.mutualFriends !== undefined
      || b.nicheMatch !== undefined,
    'must specify at least one change',
  );

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const state = await getDiscoverability(session.userId);
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ state });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'No discoverability changes provided.' },
      { status: 400 },
    );
  }

  const state = await updateDiscoverability(session.userId, parsed.data);
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({ state });
}
