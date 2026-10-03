import { NextResponse } from 'next/server';
import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { nextCassianCard } from '@/server/cassian/review';

export const dynamic = 'force-dynamic';

// Read-only visibility probe for the Daily Five. It does not expose or allocate a card.
export async function GET() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ eligible: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const card = await nextCassianCard(session.userId);
  return NextResponse.json({ card }, { headers: { 'Cache-Control': 'private, no-store' } });
}
