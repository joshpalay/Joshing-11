import { eq } from 'drizzle-orm';

import { writeActivity } from '@/server/activity/write-activity';
import { computeBeats } from '@/server/ceremony/compute-beats';
import { biweeklyCeremonies, db, users } from '@/server/db';
import { runDomainMergesForUser } from '@/server/mastery/ceremony';
import { sendSms } from '@/server/sms';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function fireCeremony(userId: string): Promise<string> {
  const cycleEnd = new Date();
  const cycleStart = new Date(cycleEnd);
  cycleStart.setDate(cycleStart.getDate() - 14);

  const mergeResult = await runDomainMergesForUser(userId);
  const beatsPayload = await computeBeats(userId, cycleStart, cycleEnd);
  if (mergeResult.mergesApplied > 0) {
    beatsPayload.mergeNote = {
      mergesApplied: mergeResult.mergesApplied,
      details: mergeResult.details,
    };
  }
  const [ceremony] = await db
    .insert(biweeklyCeremonies)
    .values({
      userId,
      cycleStart: isoDate(cycleStart),
      cycleEnd: isoDate(cycleEnd),
      firedAt: new Date(),
      beatsPayload,
    })
    .returning({ id: biweeklyCeremonies.id });

  if (!ceremony) throw new Error('Failed to create ceremony.');

  await writeActivity({
    userId,
    type: 'ceremony_ready',
    referenceId: ceremony.id,
    referenceType: 'ceremony',
  });

  const [user] = await db
    .select({ phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.phoneNumber && user.smsOptIn === 'opted_in') {
    await sendSms(
      user.phoneNumber,
      `Two weeks of Joshing. Here's what you've been up to. ${appUrl()}/ceremony/${ceremony.id}`,
      'ceremony_ready',
      userId,
    );
  }

  return ceremony.id;
}
