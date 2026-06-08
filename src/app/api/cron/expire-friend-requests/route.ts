import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/server/db'
import { isCronAuthorized } from '@/server/auth/cron'

export const dynamic = 'force-dynamic'

// Two-step cleanup on the Friendship table:
//   1. Expire stale pending requests whose expiresAt has passed.
//   2. GC declined/expired rows whose resolvedAt is older than 60 days.
//
// Both operations are idempotent; running twice in a single window is harmless.
// No ActivityItems are written — expiration and GC are passive.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const expiredResult = await db.execute(sql`
    UPDATE "Friendship"
    SET "status" = 'expired',
        "resolvedAt" = NOW()
    WHERE "status" = 'pending'
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" < NOW()
  `)

  const deletedResult = await db.execute(sql`
    DELETE FROM "Friendship"
    WHERE "status" IN ('declined', 'expired')
      AND "resolvedAt" IS NOT NULL
      AND "resolvedAt" < NOW() - INTERVAL '60 days'
  `)

  return NextResponse.json({
    ok: true,
    expired: expiredResult.rowCount ?? 0,
    deleted: deletedResult.rowCount ?? 0,
  })
}
