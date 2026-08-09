import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, missedReturnDismissed } from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';

/**
 * D-MISSED-RETURN-01 §3.3 — the per-(user, question) dismiss for the
 * missed-question return system.
 *
 * Catch-up's own dismiss is SLOT-scoped (it stamps `dismissed_at` into that
 * day's DailyQueue.slots blob, or feedItems.catchupResolvedAt). A return is by
 * definition a new slot in a different queue, so slot-level state cannot answer
 * "has this player waved this question off for good?". These helpers own that
 * question.
 *
 * A dismiss here is NEUTRAL — it writes only this row and touches no
 * mastery/points state, so it never reads as a wrong answer (§5).
 *
 * SCOPE: `questionId` is a `questions.id` (canonical questions only). LLM-origin
 * daily questions live in `generatedQuestions` and carry no `questions.id`; they
 * are out of this feature's scope by construction, exactly as they are out of
 * the Recovered pool's (MASTERY_EVENTS.question_id is null for them). Callers
 * holding a catch-up item must resolve the canonical id via `reportTarget`
 * rather than the flat `questionId` field, which can hold either FK target.
 *
 * Every read is resilient to the table not existing yet: a pre-migration
 * database returns "nothing dismissed" rather than failing the calling surface
 * (mirrors getSetAsideQuestionIds / getDismissedDomains' 42P01 handling).
 */

/** True when the viewer has an ACTIVE dismiss on this question. */
export async function isReturnDismissed(userId: string, questionId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: missedReturnDismissed.id })
      .from(missedReturnDismissed)
      .where(
        and(
          eq(missedReturnDismissed.userId, userId),
          eq(missedReturnDismissed.questionId, questionId),
          isNull(missedReturnDismissed.reinstatedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return false; // table not yet migrated
    throw error;
  }
}

/**
 * The viewer's actively-dismissed question ids. The batched form the eligibility
 * query wants — one round trip instead of one per candidate.
 *
 * Pass `questionIds` to bound the scan to a candidate set; omit it for the whole
 * set (what the Customize list needs).
 */
export async function getReturnDismissedQuestionIds(
  userId: string,
  questionIds?: readonly string[],
): Promise<Set<string>> {
  if (questionIds && questionIds.length === 0) return new Set();
  try {
    const rows = await db
      .select({ questionId: missedReturnDismissed.questionId })
      .from(missedReturnDismissed)
      .where(
        and(
          eq(missedReturnDismissed.userId, userId),
          isNull(missedReturnDismissed.reinstatedAt),
          ...(questionIds ? [inArray(missedReturnDismissed.questionId, [...questionIds])] : []),
        ),
      );
    return new Set(rows.map((r) => r.questionId));
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return new Set(); // table not yet migrated
    throw error;
  }
}

/**
 * Record a dismiss. A no-op if one is already active — the partial unique index
 * guarantees at most one active row per (user, question). Mirrors
 * setAsideRecoveredQuestion.
 *
 * Deliberately swallows 42P01 (table not yet migrated) and 23503 (the question
 * is not a canonical `questions.id`): this is a dual-write riding along on the
 * existing catch-up dismiss route, and it must never be able to fail a dismiss
 * the player already performed successfully at the slot level.
 */
export async function dismissMissedReturn(userId: string, questionId: string): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: missedReturnDismissed.id })
      .from(missedReturnDismissed)
      .where(
        and(
          eq(missedReturnDismissed.userId, userId),
          eq(missedReturnDismissed.questionId, questionId),
          isNull(missedReturnDismissed.reinstatedAt),
        ),
      )
      .limit(1);

    if (existing) return;

    await db.insert(missedReturnDismissed).values({ userId, questionId });
  } catch (error) {
    const code = pgErrorCode(error);
    // 23505: a concurrent dismiss won the race — the state we wanted is the
    // state we have. 23503: not a canonical question (see SCOPE above).
    if (code === '42P01' || code === '23503' || code === '23505') return;
    throw error;
  }
}

/**
 * Reverse a dismiss, putting the question back in return rotation. A no-op if
 * none was active. Mirrors restoreRecoveredQuestion.
 *
 * This backs BOTH reversal paths: the catch-up undismiss route (reversible
 * forever, already shipped) and Phase 3's immediate toast-undo window. Same
 * mechanism, different window — per D-doc §7-C the return surface simply never
 * builds a browsable archive on top of it.
 */
export async function reinstateMissedReturn(userId: string, questionId: string): Promise<void> {
  try {
    await db
      .update(missedReturnDismissed)
      .set({ reinstatedAt: new Date() })
      .where(
        and(
          eq(missedReturnDismissed.userId, userId),
          eq(missedReturnDismissed.questionId, questionId),
          isNull(missedReturnDismissed.reinstatedAt),
        ),
      );
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return; // table not yet migrated
    throw error;
  }
}
