import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { setMissedReturnEnabled } from '@/server/db/queries/missed-return';

export const dynamic = 'force-dynamic';

// D-MISSED-RETURN-01 §7-B1 — the single on/off toggle governing BOTH return
// scopes together. Turning it off stops FUTURE selection; a return slot already
// built into today's queue is left alone (see the note in the Customize client).
const bodySchema = z.object({ enabled: z.boolean() });

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  await setMissedReturnEnabled(session.userId, parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
