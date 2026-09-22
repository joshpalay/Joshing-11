// One-shot script: force a re-login for every account with a live session
// but an unverified phone number, so their next OTP is a real Twilio send
// to a real handset instead of the old universally-bypassable code.
//
// Why: phone_verified gates SMS reminder opt-in everywhere in the product
// (deriveReminderAcquisitionState), and verify-otp is what sets it on
// login (see src/app/api/auth/verify-otp/route.ts). Accounts created while
// AUTH_OTP_BYPASS_CODE (or its unscoped predecessor) accepted any/a fixed
// code never verified a real number, so the reminder ask has been silently
// unavailable to them since signup — see PR #1706.
//
// This does NOT touch phone_verified or any consent field directly, and it
// does not opt anyone into anything. It only deletes their live UserSession
// rows (the same effect as the existing /logout action —
// destroySession() — applied on their behalf), so their next page load
// bounces them to /login the same way an already-supported "zombie
// cookie" session does (see the comment on the onboardingComplete branch
// in src/proxy.ts). Completing a genuine OTP there sets phone_verified via
// the existing login path, and verify-otp's offerReminders flag then
// routes them straight to /reminders.
//
// Scope: only users with a NON-EXPIRED session today — an unverified user
// with no live session isn't "logged in" to force out, and would just be
// asked for a fresh OTP the next time they open the app on their own.
//
// Idempotent: re-running only ever finds sessions created after the last
// run (or a user who logged back in and stayed unverified, which shouldn't
// happen once verify-otp is deployed).
//
// Usage:
//   npx tsx scripts/force-relogin-unverified-phones.ts            # dry-run
//   npx tsx scripts/force-relogin-unverified-phones.ts --apply    # actually delete

import 'dotenv/config';

import { and, eq, gt, inArray } from 'drizzle-orm';

import { db, pool, userSessions, users } from '../src/server/db';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

function maskPhone(phone: string): string {
  return phone.length > 4 ? `***-${phone.slice(-4)}` : '***';
}

async function main() {
  console.log(`[force-relogin-unverified-phones] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const now = new Date();

  const candidates = await db
    .selectDistinct({
      userId: users.id,
      displayName: users.displayName,
      handle: users.handle,
      phoneNumber: users.phoneNumber,
      onboardingComplete: users.onboardingComplete,
    })
    .from(users)
    .innerJoin(
      userSessions,
      and(eq(userSessions.userId, users.id), gt(userSessions.expiresAt, now)),
    )
    .where(eq(users.phoneVerified, false));

  console.log(
    `[force-relogin-unverified-phones] ${candidates.length} unverified user(s) with a live session:\n`,
  );

  for (const user of candidates) {
    console.log(
      `  ${(user.displayName ?? '(no name)').padEnd(24)} @${(user.handle ?? '-').padEnd(16)} ${maskPhone(user.phoneNumber)}  onboarded=${user.onboardingComplete}`,
    );
  }

  if (candidates.length === 0) {
    console.log('\n[force-relogin-unverified-phones] nothing to do.');
    return;
  }

  if (!APPLY) {
    console.log(
      `\n[force-relogin-unverified-phones] dry run only — rerun with --apply to delete these ${candidates.length} user(s)' live sessions.`,
    );
    return;
  }

  const userIds = candidates.map((c) => c.userId);
  const deleted = await db
    .delete(userSessions)
    .where(and(inArray(userSessions.userId, userIds), gt(userSessions.expiresAt, now)))
    .returning({ id: userSessions.id });

  console.log(
    `\n[force-relogin-unverified-phones] done. ${deleted.length} session(s) deleted across ${candidates.length} user(s).`,
  );
}

main()
  .catch((err) => {
    console.error('[force-relogin-unverified-phones] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
