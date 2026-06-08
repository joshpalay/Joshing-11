import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { dismissReport, upholdReport } from '@/server/db/queries/content-reports';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reportId: z.string().trim().min(1),
  action: z.enum(['uphold', 'dismiss']),
  reviewReason: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  // Non-admins (and the unauthenticated) get 404 — never reveal the route exists.
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  const { reportId, action, reviewReason } = parsed.data;
  const result =
    action === 'uphold'
      ? await upholdReport(reportId, reviewReason)
      : await dismissReport(reportId, reviewReason);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'not_found' ? 404 : 409 },
    );
  }

  return NextResponse.json(result);
}
