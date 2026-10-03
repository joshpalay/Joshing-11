import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { answerCassianCard } from '@/server/cassian/review';

const bodySchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{32}$/),
  answer: z.string().max(500),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid answer.' }, { status: 400 });
  const reveal = await answerCassianCard(session.userId, body.data.candidateId, body.data.answer);
  if (!reveal) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ reveal }, { headers: { 'Cache-Control': 'private, no-store' } });
}
