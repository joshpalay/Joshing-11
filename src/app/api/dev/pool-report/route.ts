import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getPoolReport } from '@/server/db/queries/pool-report';
import { isTierGatingEnabled } from '@/server/daily/verification-gating';

export const dynamic = 'force-dynamic';

// B4 Phase 3 reporting: eligible pool sizes per serving surface under the §6 tier
// rules, plus the current enforcement-flag state. Read-only. Used to confirm
// pools are healthy BEFORE flipping VERIFICATION_TIER_GATING_ENABLED.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const report = await getPoolReport();
  return NextResponse.json({
    tierGatingEnforced: isTierGatingEnabled(),
    ...report,
  });
}
