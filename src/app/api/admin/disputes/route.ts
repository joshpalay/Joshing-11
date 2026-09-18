import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { resolveGradeDispute } from '@/server/db/queries/grade-disputes';

export const dynamic = 'force-dynamic';

// B-13.4 — the one mutation this minimal queue needs: mark a pending
// GradeDispute 'reviewed' (the admin looked at it, no further action tracked
// here) or 'dismissed' (not a real issue). Same admin gate as every other
// /admin surface: unlisted admins get 404, never 403, so the route's
// existence is never revealed to non-admins.
const bodySchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(['reviewed', 'dismissed']),
});

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  await resolveGradeDispute(parsed.data.id, parsed.data.status);
  return NextResponse.json({ ok: true });
}
