import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { dismissReport, reverseBlock, upholdReport } from '@/server/db/queries/content-reports';

export const dynamic = 'force-dynamic';

const reviewReason = z.string().trim().max(500).optional();

// uphold/dismiss act on an OPEN report (keyed by reportId); reverse un-blocks an
// already-actioned target (keyed by the question/generated id), so it carries a
// target instead of a reportId.
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('uphold'), reportId: z.string().trim().min(1), reviewReason }),
  z.object({ action: z.literal('dismiss'), reportId: z.string().trim().min(1), reviewReason }),
  z.object({
    action: z.literal('reverse'),
    target: z.object({ table: z.enum(['question', 'generated']), id: z.string().trim().min(1) }),
    reviewReason,
  }),
]);

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

  const data = parsed.data;
  const result =
    data.action === 'uphold'
      ? await upholdReport(data.reportId, data.reviewReason)
      : data.action === 'dismiss'
        ? await dismissReport(data.reportId, data.reviewReason)
        : await reverseBlock(data.target, data.reviewReason);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'not_found' ? 404 : 409 },
    );
  }

  return NextResponse.json(result);
}
