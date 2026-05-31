import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { dismissAreaTopUpPrompt } from '@/server/db/queries/area-top-up';

// POST /api/declared-interests/top-up/dismiss
//
// Records the one-time dismissal of the "add two more areas" prompt so it
// never reappears. Called both when the user skips the prompt and (by the
// client) after a successful save, so saving also stops future prompts.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await dismissAreaTopUpPrompt(session.userId);
  return NextResponse.json({ ok: true });
}
