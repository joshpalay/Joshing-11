import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, users } from '@/server/db';
import { runAggressiveDomainBackfillForUser } from '@/server/mastery/ceremony';
import { isCronAuthorized } from '@/server/auth/cron';

export const dynamic = 'force-dynamic';

type PerUserResult = {
  userId: string;
  mergesProposed: number;
  mergesApplied: number;
  errors: string[];
};

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { userId?: string; dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — all fields are optional
  }

  const { userId: targetUserId, dryRun = false } = body;

  const userIds: string[] = [];

  if (targetUserId) {
    userIds.push(targetUserId);
  } else {
    const onboardedUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.onboardingComplete, true));
    userIds.push(...onboardedUsers.map((u) => u.id));
  }

  let totalMergesProposed = 0;
  let totalMergesApplied = 0;
  const perUserResults: PerUserResult[] = [];

  for (const userId of userIds) {
    const errors: string[] = [];
    let mergesProposed = 0;
    let mergesApplied = 0;

    try {
      const result = await runAggressiveDomainBackfillForUser(userId, { dryRun });
      mergesProposed = result.mergesProposed;
      mergesApplied = result.mergesApplied;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-domains] user=${userId} error: ${message}`);
      errors.push(message);
    }

    totalMergesProposed += mergesProposed;
    totalMergesApplied += mergesApplied;
    perUserResults.push({ userId, mergesProposed, mergesApplied, errors });
  }

  return NextResponse.json({
    usersProcessed: userIds.length,
    totalMergesProposed,
    totalMergesApplied,
    perUserResults,
  });
}
