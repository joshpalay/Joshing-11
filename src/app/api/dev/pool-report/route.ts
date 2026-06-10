import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getPoolDepthByDomain, getPoolReport } from '@/server/db/queries/pool-report';
import { isTierGatingEnabled } from '@/server/daily/verification-gating';

export const dynamic = 'force-dynamic';

// B4 Phase 3 reporting: eligible pool sizes per serving surface under the §6 tier
// rules, plus the current enforcement-flag state. Read-only. Used to confirm
// pools are healthy BEFORE flipping VERIFICATION_TIER_GATING_ENABLED.
// depthByDomain (BP-7 Phase 3): per-domain distinct-fact depth, thinnest first —
// read alongside the [daily/bank-telemetry] logs before flipping
// RETRIEVAL_GROUNDING_ENABLED (see docs/retrieval-flip-checklist.md).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [report, depthByDomain] = await Promise.all([
    getPoolReport(),
    getPoolDepthByDomain(),
  ]);
  return NextResponse.json({
    tierGatingEnforced: isTierGatingEnabled(),
    ...report,
    depthByDomain,
  });
}
