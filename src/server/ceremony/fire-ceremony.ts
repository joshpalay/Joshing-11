import { and, eq, gte, lte } from 'drizzle-orm';

import { writeActivity } from '@/server/activity/write-activity';
import { beatsPayloadSchema, computeBeats } from '@/server/ceremony/compute-beats';
import { biweeklyCeremonies, db, masteryEvents, users } from '@/server/db';
import { runDomainMergesForUser } from '@/server/mastery/ceremony';
import { sendSms } from '@/server/sms';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

async function findExistingCeremony(
  userId: string,
  cycleStartIso: string,
  cycleEndIso: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: biweeklyCeremonies.id })
    .from(biweeklyCeremonies)
    .where(
      and(
        eq(biweeklyCeremonies.userId, userId),
        eq(biweeklyCeremonies.cycleStart, cycleStartIso),
        eq(biweeklyCeremonies.cycleEnd, cycleEndIso),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function hasMasteryEventInCycle(
  userId: string,
  cycleStart: Date,
  cycleEnd: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: masteryEvents.id })
    .from(masteryEvents)
    .where(
      and(
        eq(masteryEvents.userId, userId),
        gte(masteryEvents.createdAt, cycleStart),
        lte(masteryEvents.createdAt, cycleEnd),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function fireCeremony(userId: string): Promise<string | null> {
  const cycleEnd = new Date();
  const cycleStart = new Date(cycleEnd);
  cycleStart.setDate(cycleStart.getDate() - 7);
  const cycleStartIso = isoDate(cycleStart);
  const cycleEndIso = isoDate(cycleEnd);

  // F3.3 idempotency: if a ceremony already exists for this (user, cycle),
  // return it without redoing domain merges, recomputing beats, writing a
  // duplicate activity row, or sending another SMS. The DB unique index
  // makes this race-safe; this pre-check just avoids the wasted work in
  // the common case.
  const existingId = await findExistingCeremony(userId, cycleStartIso, cycleEndIso);
  if (existingId) return existingId;

  // PRD §8.1.31 eligibility: a ceremony is the climax of activity, not a
  // scheduled empty notification. Users with zero mastery events in the
  // cycle window receive silence — no ceremony row, no activity item,
  // no SMS.
  const hasActivity = await hasMasteryEventInCycle(userId, cycleStart, cycleEnd);
  if (!hasActivity) return null;

  const mergeResult = await runDomainMergesForUser(userId);
  const beatsPayload = await computeBeats(userId, cycleStart, cycleEnd);
  if (mergeResult.mergesApplied > 0) {
    beatsPayload.mergeNote = {
      mergesApplied: mergeResult.mergesApplied,
      details: mergeResult.details,
    };
  }

  // F3.5: strict validation at write — catch any compute-beats bugs before
  // they land in the DB as malformed JSONB. Throws on shape mismatch; the
  // cron handler will see the exception and skip this user rather than
  // shipping a broken ceremony.
  beatsPayloadSchema.parse(beatsPayload);

  let ceremonyId: string;
  try {
    const [ceremony] = await db
      .insert(biweeklyCeremonies)
      .values({
        userId,
        cycleStart: cycleStartIso,
        cycleEnd: cycleEndIso,
        firedAt: new Date(),
        beatsPayload,
      })
      .returning({ id: biweeklyCeremonies.id });

    if (!ceremony) throw new Error('Failed to create ceremony.');
    ceremonyId = ceremony.id;
  } catch (error) {
    // Concurrent fire raced us: the unique index on (userId, cycleStart,
    // cycleEnd) rejected our insert. Look up the row that won and treat
    // this call as a successful no-op.
    const concurrentExistingId = await findExistingCeremony(userId, cycleStartIso, cycleEndIso);
    if (concurrentExistingId) return concurrentExistingId;
    throw error;
  }

  await writeActivity({
    userId,
    type: 'ceremony_ready',
    referenceId: ceremonyId,
    referenceType: 'ceremony',
  });

  const [user] = await db
    .select({ phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.phoneNumber && user.smsOptIn !== 'opted_out') {
    await sendSms(
      user.phoneNumber,
      `A week of Joshing. Here's what you've been up to. ${appUrl()}/ceremony/${ceremonyId}`,
      'ceremony_ready',
      userId,
    );
  }

  return ceremonyId;
}
