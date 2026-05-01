import { NextResponse } from 'next/server';

import { destroySession, getSession } from '@/server/auth/session';

export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await destroySession();

  return NextResponse.json({ ok: true });
}
