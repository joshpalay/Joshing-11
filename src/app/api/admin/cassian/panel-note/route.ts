import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { saveCassianPanelNote } from '@/server/cassian/review';

const bodySchema = z.object({
  id: z.string().uuid(),
  area: z.enum(['Missing topic', 'Variety', 'UI issue']),
  text: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid note.' }, { status: 400 });
  await saveCassianPanelNote(session.userId, body.data);
  return NextResponse.json({ saved: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
