import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { proofreadInterestLabels } from '@/server/llm/interests';

// Inline Haiku call; keep a modest budget above the default so a slow proofread
// completes rather than being platform-killed.
export const maxDuration = 30;

const bodySchema = z.object({
  interests: z.array(z.string().trim().min(1).max(60)).max(3),
});

// Pre-send double-check for the interest labels an inviter suggests on a friend
// invitation. Catches obvious spelling typos ("Obama-Era poicy" -> "Obama-Era
// Policy") so the inviter can confirm or fix a suggestion before it ships.
// Proofreading fails open (see proofreadInterestLabels), so an LLM outage returns
// no corrections and the invite flow proceeds with the typed labels unchanged.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Send up to three short ideas.' },
      { status: 400 },
    );
  }

  const results = await proofreadInterestLabels(parsed.data.interests);
  return NextResponse.json({ results });
}
