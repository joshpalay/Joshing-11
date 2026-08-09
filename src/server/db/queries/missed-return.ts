import { and, eq, sql } from 'drizzle-orm';

import {
  dailyPreferences,
  db,
  missedReturnState,
  questions,
} from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';
import { CATCHUP_LOOKBACK_DAYS } from '@/server/daily/catchup';
import {
  MISSED_RETURN_COOLDOWN_DAYS,
  MISSED_RETURN_LIFETIME_CAP,
  type ReturnCandidate,
  type ReturnScope,
} from '@/server/daily/missed-return';

/**
 * D-MISSED-RETURN-01 §4 — return eligibility, in one query.
 *
 * A question is eligible to return to player P when ALL of these hold:
 *
 *   1. P's last answer on it was `incorrect`, OR it expired unanswered on P's
 *      queue
 *   2. No correct answer from P has ever been recorded on it (R6 — stop on first
 *      correct; the question retires permanently and becomes a Recovered card)
 *   3. returnCount < 3 (R7), counted for the WRONG scope only — an expired
 *      question's first appearance has never been seen, so it is a first ask
 *      arriving late, not a return (§2)
 *   4. lastReturnedAt is null or >= 7 days ago (R5 — a FLOOR, not a schedule)
 *   5. No active MissedReturnDismissed row for (P, question)
 *   6. P's return toggle is on (§7-B1; absent DailyPreference row reads as ON)
 *   7. The question is still live (not soft-deleted)
 *
 * SCOPE — canonical questions only. Both scopes key on `Question.id`:
 * MASTERY_EVENTS.question_id is null for LLM-origin generated questions and a
 * generated daily slot carries `generated_question_id` instead, so neither can
 * produce a candidate. This matches the Recovered deck, which excludes them for
 * the same reason, and is why the return loop's exit (§3.1) needs no new code.
 *
 * Ranking is NOT done here — see `rankReturnCandidates`. This returns the whole
 * eligible set because the Customize list (Phase 3) needs it too; the queue
 * builder takes 1 (R2).
 */

/** Rows come back pre-shaped for both consumers: the queue builder and Customize. */
export async function getEligibleReturnCandidates(
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<ReturnCandidate[]> {
  try {
    const cooldownCutoff = new Date(
      now.getTime() - MISSED_RETURN_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    );
    // A question only counts as "expired" once it has aged out of catch-up —
    // before that it is still reachable there and returning it would double-serve.
    const expiredBefore = new Date(
      now.getTime() - CATCHUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    const rows = await db.execute<{
      questionId: string;
      scope: ReturnScope;
      lastSeenAt: Date;
      returnCount: number;
    }>(sql`
      WITH
      -- (1a) WRONG scope: the player's most recent answer on the question was
      -- incorrect. answered_by_user_id = user_id keeps this to answers THEY gave.
      wrong AS (
        SELECT DISTINCT ON (me.question_id)
          me.question_id AS "questionId",
          me.created_at  AS "lastSeenAt"
        FROM "MASTERY_EVENTS" me
        WHERE me.user_id = ${userId}
          AND me.question_id IS NOT NULL
          AND me.answer_state IS NOT NULL
        ORDER BY me.question_id, me.created_at DESC
      ),
      wrong_scope AS (
        SELECT "questionId", "lastSeenAt" FROM wrong
        WHERE "questionId" IN (
          SELECT me.question_id FROM "MASTERY_EVENTS" me
          WHERE me.user_id = ${userId}
            AND me.question_id IS NOT NULL
            AND me.answer_state = 'incorrect'
        )
      ),
      -- (1b) EXPIRED scope: an unanswered, undismissed daily slot on a queue old
      -- enough to have fallen out of catch-up. Canonical slots only.
      expired_scope AS (
        SELECT DISTINCT
          slot->>'question_id' AS "questionId",
          max(q.queue_date::timestamptz) OVER (PARTITION BY slot->>'question_id') AS "lastSeenAt"
        FROM "DailyQueue" q, LATERAL jsonb_array_elements(q.slots) AS slot
        WHERE q.user_id = ${userId}
          AND q.queue_date::timestamptz < ${expiredBefore}
          AND slot->>'question_id' IS NOT NULL
          AND slot->>'generated_question_id' IS NULL
          AND COALESCE(slot->>'answered', 'false') = 'false'
          AND slot->>'dismissed_at' IS NULL
      ),
      -- (2) R6: any correct answer ever retires the question permanently.
      ever_correct AS (
        SELECT DISTINCT me.question_id AS "questionId"
        FROM "MASTERY_EVENTS" me
        WHERE me.user_id = ${userId}
          AND me.question_id IS NOT NULL
          AND me.answer_state IN ('first_correct', 'first_correct_after_wrong', 'repeat_correct')
      ),
      -- (5) An ACTIVE dismiss suppresses the question outright.
      dismissed AS (
        SELECT "questionId" FROM "MissedReturnDismissed"
        WHERE "userId" = ${userId} AND "reinstatedAt" IS NULL
      ),
      -- Wrong takes precedence when a question qualifies under both: it HAS been
      -- seen, so it must carry the return framing and the 3-return cap.
      unioned AS (
        SELECT "questionId", 'wrong'::text AS scope, "lastSeenAt" FROM wrong_scope
        UNION ALL
        SELECT "questionId", 'expired'::text AS scope, "lastSeenAt" FROM expired_scope
        WHERE "questionId" NOT IN (SELECT "questionId" FROM wrong_scope)
      )
      SELECT
        u."questionId"                     AS "questionId",
        u.scope                            AS scope,
        u."lastSeenAt"                     AS "lastSeenAt",
        COALESCE(s."returnCount", 0)       AS "returnCount"
      FROM unioned u
      -- NOTE: Question is snake_case here ("deleted_at"), unlike the camelCase
      -- MissedReturn* tables above. Getting this wrong raises 42703, which is
      -- deliberately NOT swallowed below — see the catch.
      JOIN "Question" qq ON qq.id = u."questionId" AND qq.deleted_at IS NULL
      LEFT JOIN "MissedReturnState" s
        ON s."userId" = ${userId} AND s."questionId" = u."questionId"
      WHERE u."questionId" NOT IN (SELECT "questionId" FROM ever_correct)
        AND u."questionId" NOT IN (SELECT "questionId" FROM dismissed)
        -- (4) 7-day floor between sightings.
        AND (s."lastReturnedAt" IS NULL OR s."lastReturnedAt" <= ${cooldownCutoff})
        -- (3) lifetime cap, wrong scope only.
        AND (u.scope <> 'wrong' OR COALESCE(s."returnCount", 0) < ${MISSED_RETURN_LIFETIME_CAP})
    `);

    return (rows as unknown as ReturnCandidate[]).map((row) => ({
      questionId: row.questionId,
      scope: row.scope,
      lastSeenAt: new Date(row.lastSeenAt),
      returnCount: Number(row.returnCount ?? 0),
    }));
  } catch (error) {
    // A pre-migration database (missing MissedReturnState/MissedReturnDismissed)
    // yields no candidates rather than failing the whole queue build — mirrors
    // getSetAsideQuestionIds' 42P01 handling.
    //
    // 42703 (undefined_column) is deliberately NOT swallowed. A wrong column name
    // in the SQL above is a CODING error, not a migration state, and swallowing
    // it would make this function silently return [] forever — the feature would
    // ship, the flag would flip, and no return slot would ever appear. That is
    // exactly the "feature lands dark" failure §8.3 warns about, and it nearly
    // happened here: Question is snake_case ("deleted_at") while the MissedReturn*
    // tables are camelCase. The orchestrator's own try/catch still degrades the
    // build gracefully, but it LOGS instead of failing quietly.
    if (pgErrorCode(error) === '42P01') return [];
    throw error;
  }
}

/**
 * §7-B1/§7-F1 — the Customize toggle, default ON.
 *
 * A user with NO DailyPreference row reads as ENABLED. Reading the column
 * through a plain join would make "never opened Customize" mean "opted out",
 * silently withholding the feature from exactly the least-engaged players it is
 * meant to reach.
 */
export async function isMissedReturnEnabledForUser(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ enabled: dailyPreferences.missedReturnEnabled })
      .from(dailyPreferences)
      .where(eq(dailyPreferences.userId, userId))
      .limit(1);
    return row ? row.enabled : true;
  } catch (error) {
    if (pgErrorCode(error) === '42703') return true; // column not yet migrated
    throw error;
  }
}

/**
 * Record that a question was served as a return. Upserts the (user, question)
 * row, always stamping `lastReturnedAt` (which drives the 7-day floor) and
 * incrementing `returnCount` for the WRONG scope only (§2 — an expired
 * question's first appearance is a first ask arriving late, not a return).
 */
export async function recordReturnServed(
  userId: string,
  questionId: string,
  scope: ReturnScope,
  { now = new Date() }: { now?: Date } = {},
): Promise<void> {
  const increment = scope === 'wrong' ? 1 : 0;
  try {
    await db
      .insert(missedReturnState)
      .values({ userId, questionId, lastReturnedAt: now, returnCount: increment })
      .onConflictDoUpdate({
        target: [missedReturnState.userId, missedReturnState.questionId],
        set: {
          lastReturnedAt: now,
          returnCount: sql`${missedReturnState.returnCount} + ${increment}`,
        },
      });
  } catch (error) {
    if (pgErrorCode(error) === '42P01') return; // table not yet migrated
    throw error;
  }
}

/** Live question text/answer for the candidates the builder decided to serve. */
export async function loadReturnQuestions(questionIds: readonly string[]) {
  if (questionIds.length === 0) return [];
  return db
    .select({
      id: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      creatorId: questions.creatorId,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      questionType: questions.questionType,
      difficultyEstimate: questions.difficultyEstimate,
      creatorNote: questions.creatorNote,
      source: questions.source,
    })
    .from(questions)
    .where(and(sql`${questions.id} = ANY(${[...questionIds]})`, sql`${questions.deletedAt} IS NULL`));
}
