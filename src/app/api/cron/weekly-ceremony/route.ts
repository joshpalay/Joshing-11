import { and, desc, eq, gte } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { fireCeremony } from '@/server/ceremony/fire-ceremony';
import { biweeklyCeremonies, db, users } from '@/server/db';

export const dynamic = 'force-dynamic';

// Cadence: ceremonies fire on Sundays in UTC at 08:00. The cron runs every day
// as a safety net (idempotent: the unique (userId, cycleStart, cycleEnd) index
// prevents duplicate fires), but the gate below makes Sunday the only day any
// new ceremony actually lands.
const CEREMONY_WEEKDAY_UTC = 0; // 0 = Sunday
const MIN_ACCOUNT_AGE_DAYS = 3; // brand-new accounts wait for their first real Sunday
const RECENT_FIRE_LOOKBACK_DAYS = 6; // dedupe: a user can't fire twice within 6 days

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('cron_secret') === secret
    || request.headers.get('x-cron-secret') === secret
    || request.headers.get('authorization') === `Bearer ${secret}`;
}

function daysSinceUtc(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((endUtc - startUtc) / 86_400_000);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = new Date();
  if (today.getUTCDay() !== CEREMONY_WEEKDAY_UTC) {
    return NextResponse.json({ fired: 0, skipped: 0, skippedNoActivity: 0, skippedNotCeremonyDay: true });
  }

  const recentCutoff = new Date(today);
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - RECENT_FIRE_LOOKBACK_DAYS);

  const onboardedUsers = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.onboardingComplete, true));

  let fired = 0;
  let skipped = 0;
  let skippedNoActivity = 0;

  for (const user of onboardedUsers) {
    const accountAgeDays = daysSinceUtc(user.createdAt, today);
    if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
      skipped += 1;
      continue;
    }

    const [recentCeremony] = await db
      .select({ id: biweeklyCeremonies.id })
      .from(biweeklyCeremonies)
      .where(and(eq(biweeklyCeremonies.userId, user.id), gte(biweeklyCeremonies.firedAt, recentCutoff)))
      .orderBy(desc(biweeklyCeremonies.firedAt))
      .limit(1);

    if (recentCeremony) {
      skipped += 1;
      continue;
    }

    const ceremonyId = await fireCeremony(user.id);
    if (ceremonyId) {
      fired += 1;
    } else {
      skippedNoActivity += 1;
    }
  }

  return NextResponse.json({ fired, skipped, skippedNoActivity });
}
