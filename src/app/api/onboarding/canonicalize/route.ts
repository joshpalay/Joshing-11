import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { canonicalizeInterest } from '@/server/llm/interests';

type CanonicalizeBody = {
  rawInput?: unknown;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CanonicalizeBody | null;
  const original =
    typeof body?.rawInput === 'string' ? body.rawInput.trim().replace(/\s+/g, ' ') : '';

  if (original.length < 2 || original.length > 100) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Interest must be 2 to 100 characters.' },
      { status: 400 },
    );
  }

  try {
    const canonicalized = await canonicalizeInterest(original);
    return NextResponse.json({ original, ...canonicalized });
  } catch {
    return NextResponse.json({
      original,
      suggested: original,
      // null, not the catch-all — the save path re-categorizes before persisting.
      broadCategory: null,
      explanation: null,
    });
  }
}
