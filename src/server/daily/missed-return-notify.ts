import { eq } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { writeActivity } from '@/server/activity/write-activity';
import { sendSms } from '@/server/sms';

/**
 * D-MISSED-RETURN-01 §7-A1 — tell the AUTHOR when a question they wrote came
 * back to someone who once missed it and this time landed correct.
 *
 * "The wrong→right moment is the strongest positive signal the product generates
 * and today nothing carries it back to the author. Full push, not just a feed
 * entry."
 *
 * WHAT "PUSH" MEANS HERE (searched before building, per the build slate): there
 * is NO web-push infrastructure in this codebase — no service worker, no
 * PushSubscription table, no VAPID keys. The two real channels are:
 *   - `writeActivity`  → the bell / Home activity stream (a feed entry)
 *   - `sendSms`        → Twilio, the only actual push-to-device path
 * So §7-A1's "full push, not just a feed entry" is satisfied by doing BOTH, with
 * SMS as the push. Nothing new was built.
 *
 * Both writes are best-effort and swallow their own errors: this fires from the
 * answer path, and an author's notification must never be able to fail a
 * player's answer.
 *
 * WRONG SCOPE ONLY. An expired-scope return has never been seen by the player,
 * so a correct answer on it is an ordinary first correct — there is no
 * "what you taught them stuck" story to carry back, and firing for it would
 * dilute the signal this notification exists to deliver.
 *
 * COPY IS A PLACEHOLDER. §6/§9 hold the copy pass as a separate gate, and Phase 4
 * of the build slate replaces the string below verbatim from the approved pass.
 * The register is the hard part: never "they got your question wrong then right",
 * never a remediation framing. Reference voice is RecoveredDeck (§3.1).
 */
export async function notifyAuthorOfReturnRecovery(params: {
  /** The question's author. */
  authorUserId: string;
  /** The player who just recovered it. */
  answererUserId: string;
  questionId: string;
  /** Optional override; resolved from the answerer's profile when omitted. */
  answererName?: string | null;
  baseUrl?: string;
}): Promise<void> {
  const { authorUserId, answererUserId, questionId } = params;

  // Never notify someone about their own answer.
  if (!authorUserId || authorUserId === answererUserId) return;

  await writeActivity({
    userId: authorUserId,
    type: 'missed_return_recovered',
    actorUserId: answererUserId,
    referenceId: questionId,
    referenceType: 'question',
  });

  try {
    const [author] = await db
      .select({ phone: users.phoneNumber, optIn: users.smsOptIn })
      .from(users)
      .where(eq(users.id, authorUserId))
      .limit(1);

    if (!author?.phone || author.optIn !== 'opted_in') return;

    let name = params.answererName?.trim() || '';
    if (!name) {
      const [answerer] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, answererUserId))
        .limit(1);
      name = answerer?.displayName?.trim() || '';
    }
    if (!name) name = 'Someone';
    const baseUrl = params.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';
    // PLACEHOLDER COPY — replaced wholesale in Phase 4 from the approved pass.
    const message = `${name} came back to your question and got it. ${baseUrl}/activities`.trim();

    await sendSms(author.phone, message, 'missed_return_recovered', authorUserId);
  } catch (error) {
    console.warn('[missed-return] author push failed', {
      authorUserId,
      questionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
