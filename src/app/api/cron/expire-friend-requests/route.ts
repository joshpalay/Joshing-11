import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

// Two-step cleanup on the Friendship table:
//   1. Expire stale pending requests whose expiresAt has passed.
//   2. GC declined/expired rows whose resolvedAt is older than 60 days.
//
// Both operations are idempotent; running twice in a single window is harmless.
// No ActivityItems are written — expiration and GC are passive.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const expiredResult = await db.execute(sql`
    UPDATE "Friendship"
    SET "status" = 'expired',
        "resolvedAt" = NOW()
    WHERE "status" = 'pending'
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" < NOW()
  `);

  const deletedResult = await db.execute(sql`
    DELETE FROM "Friendship"
    WHERE "status" IN ('declined', 'expired')
      AND "resolvedAt" IS NOT NULL
      AND "resolvedAt" < NOW() - INTERVAL '60 days'
  `);

  return NextResponse.json({
    ok: true,
    expired: expiredResult.rowCount ?? 0,
    deleted: deletedResult.rowCount ?? 0,
  });
}
