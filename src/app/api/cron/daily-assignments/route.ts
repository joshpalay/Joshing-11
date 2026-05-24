import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getTodaysDailyQueue } from '@/server/db/queries/daily';
import { db, users } from '@/server/db';
import { DailyQueueFillError, fillDailyQueueForUser } from '@/server/daily/queue-orchestrator';
import { type QueueSlot } from '@/server/daily/types';
import { runWithConcurrency } from '@/server/lib/concurrency';
import { sendSms } from '@/server/sms';

export const dynamic = 'force-dynamic';

// Capped at 4 to stay one connection below the 5-cap DB pool. Tune down if
// the SMS provider's per-second rate becomes the binding limit instead of DB.
const USER_CONCURRENCY = 4;

function asQueueSlots(value: unknown): QueueSlot[] {
  return Array.isArray(value) ? (value as QueueSlot[]) : [];
}

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : 'http://localhost:3000';
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baseUrl = getBaseUrl(request);
  const onboardedUsers = await db
    .select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(eq(users.onboardingComplete, true));

  const results = {
    users: onboardedUsers.length,
    generated: 0,
    existing: 0,
    failed: 0,
    smsSent: 0,
  };

  await runWithConcurrency(onboardedUsers, USER_CONCURRENCY, async (user) => {
    try {
      let queue = await getTodaysDailyQueue(user.id);
      const existingSlots = queue ? asQueueSlots(queue.slots) : [];

      if (!queue || existingSlots.length === 0) {
        await fillDailyQueueForUser(user.id);
        queue = await getTodaysDailyQueue(user.id);
        results.generated += 1;
      } else {
        results.existing += 1;
      }

      if (queue && user.smsOptIn === 'opted_in' && user.phoneNumber) {
        await sendSms(
          user.phoneNumber,
          `Your five for today. ${baseUrl}/daily`,
          'daily_questions',
          user.id,
        );
        results.smsSent += 1;
      }
    } catch (error) {
      if (error instanceof DailyQueueFillError) {
        results.failed += 1;
        return;
      }

      console.error('[cron/daily-assignments] user failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      results.failed += 1;
    }
  });

  return NextResponse.json(results);
}
