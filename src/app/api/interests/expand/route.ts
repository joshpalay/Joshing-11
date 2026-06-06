import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { expandBroadInterest } from '@/server/llm/interests';

// Inline Haiku call; keep a modest budget above the default so a slow expansion
// completes rather than being platform-killed.
export const maxDuration = 30;

const bodySchema = z.object({
  topic: z.string().trim().min(1).max(80),
});

// Break a too-broad topic ("Music", "Technology") into specific, passion-level
// choices for the add-topic field's expand-into-choices flow.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter a topic (up to 80 characters).' },
      { status: 400 },
    );
  }

  const candidates = await expandBroadInterest(parsed.data.topic);
  return NextResponse.json({ topic: parsed.data.topic, candidates });
}
