import { and, desc, eq, gte } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { fireCeremony } from '@/server/ceremony/fire-ceremony';
import { biweeklyCeremonies, db, users } from '@/server/db';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.VERCEL_CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('cron_secret') === secret
    || request.headers.get('x-cron-secret') === secret
    || request.headers.get('authorization') === `Bearer ${secret}`;
}

function dateInNewYork(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function daysBetweenNewYorkDates(start: Date, end: Date): number {
  const startDate = dateInNewYork(start);
  const endDate = dateInNewYork(end);
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = new Date();
  const recentCutoff = new Date(today);
  recentCutoff.setDate(recentCutoff.getDate() - 13);
  const onboardedUsers = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.onboardingComplete, true));

  let fired = 0;
  let skipped = 0;

  for (const user of onboardedUsers) {
    const accountAgeDays = daysBetweenNewYorkDates(user.createdAt, today);
    const isCeremonyDay = accountAgeDays > 0 && accountAgeDays % 14 === 0;
    if (!isCeremonyDay) {
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

    await fireCeremony(user.id);
    fired += 1;
  }

  return NextResponse.json({ fired, skipped });
}
