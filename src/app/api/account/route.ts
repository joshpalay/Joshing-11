import { NextResponse } from 'next/server';
import { z } from 'zod';

import { destroySession, getSession } from '@/server/auth/session';
import { deleteUserAccount, getUserProfile, updateDisplayName } from '@/server/db/queries/account';

const DISPLAY_NAME_ERROR = 'Display name must be 2-30 characters.';

const patchBodySchema = z.object({ displayName: z.string() });

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const profile = await getUserProfile(session.userId);

  if (!profile) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = patchBodySchema.safeParse(await request.json().catch(() => null));
  const displayName = parsed.success ? parsed.data.displayName.trim() : '';

  if (displayName.length < 2 || displayName.length > 30) {
    return NextResponse.json({ error: DISPLAY_NAME_ERROR }, { status: 400 });
  }

  const result = await updateDisplayName({ userId: session.userId, displayName });

  if (!result.ok && result.reason === 'invalid') {
    return NextResponse.json({ error: DISPLAY_NAME_ERROR }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}


export async function DELETE() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await deleteUserAccount(session.userId);
  await destroySession();

  return NextResponse.json({ ok: true });
}
