import { asc, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { db, users } from '@/server/db';

export const dynamic = 'force-dynamic';

function displayName(name: string | null, fallback: string): string {
  return name?.trim() || fallback;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // TODO Phase 8: replace with friends-only list when friend system is built.
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, phoneNumber: users.phoneNumber })
    .from(users)
    .where(ne(users.id, session.userId))
    .orderBy(asc(users.displayName), asc(users.phoneNumber));

  return NextResponse.json(
    rows.map((user) => ({
      id: user.id,
      displayName: displayName(user.displayName, user.phoneNumber),
    })),
  );
}
