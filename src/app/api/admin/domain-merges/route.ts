import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { runDomainMergeApply, runDomainMergePreview } from '@/server/db/queries/domain-merges';

export const dynamic = 'force-dynamic';
// Apply is one transaction over the low-hundreds of rows a label spans; preview is
// a read-only census. Both finish in well under a second, but leave headroom.
export const maxDuration = 60;

// Each decision is one surviving `target` label plus the `source` labels folding
// into it. The UI derives these from the weekly fragmentation candidates; we
// re-validate shape here (never trust the client) and let the shared applier's
// census/ABORT guard do the real safety check against the live corpus.
const mergeSpec = z.object({
  target: z.string().trim().min(1).max(200),
  sources: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
});
const bodySchema = z.object({
  action: z.enum(['preview', 'apply']),
  merges: z.array(mergeSpec).min(1).max(50),
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

  const { action, merges } = parsed.data;

  try {
    if (action === 'preview') {
      const preview = await runDomainMergePreview(merges);
      return NextResponse.json(preview);
    }
    const result = await runDomainMergeApply(merges);
    // An unhandled-table abort or a no-op is a client-actionable 409, not a 500.
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[admin/domain-merges] failed', error);
    return NextResponse.json({ error: 'merge_failed' }, { status: 500 });
  }
}
