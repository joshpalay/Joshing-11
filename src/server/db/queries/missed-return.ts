import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  dailyPreferences,
  db,
  generatedQuestions,
  missedReturnState,
  questions,
} from '@/server/db';
import { pgErrorCode } from '@/server/db/pg-error';
import { CATCHUP_LOOKBACK_DAYS } from '@/server/daily/catchup';
import { resolveCreatorNames } from '@/server/db/queries/daily';
import {
  MISSED_RETURN_COOLDOWN_DAYS,
  MISSED_RETURN_LIFETIME_CAP,
  rankReturnCandidates,
  type ReturnCandidate,
  type ReturnQuestionKind,
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
  { now = new Date(), limit }: { now?: Date; limit?: number } = {},
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
      kind: ReturnQuestionKind;
      questionId: string;
      scope: ReturnScope;
      lastSeenAt: Date;
      returnCount: number;
    }>(sql`
      WITH
      -- ================= GENERATED (LLM-origin) QUESTIONS =================
      -- These live in GeneratedQuestion, and MASTERY_EVENTS.question_id is NULL
      -- for them (the writer only ever stores eventQuestionId, which is
      -- canonical-only). Their entire answer history exists in DailyQueue.slots
      -- — which is exactly why catch-up sees them. Measured on prod, they are
      -- ~96% of the wrong answers inside the Daily Five, so omitting them makes
      -- the whole feature return almost nothing anyone actually missed.
      gen_slots AS (
        SELECT
          slot->>'generated_question_id'                  AS gid,
          COALESCE(slot->>'answered', 'false') = 'true'   AS answered,
          slot->>'answer_state'                           AS answer_state,
          slot->>'catchup_answer_state'                   AS catchup_answer_state,
          slot->>'dismissed_at'                           AS dismissed_at,
          q.queue_date::timestamptz                       AS queue_date
        FROM "DailyQueue" q, LATERAL jsonb_array_elements(q.slots) AS slot
        WHERE q.user_id = ${userId}
          AND slot->>'generated_question_id' IS NOT NULL
      ),
      -- R6 for generated questions: a correct answer on EITHER the live round or
      -- a later catch-up attempt retires it permanently.
      gen_ever_correct AS (
        SELECT DISTINCT gid FROM gen_slots
        WHERE answer_state = 'correct' OR catchup_answer_state = 'correct'
      ),
      gen_wrong AS (
        SELECT gid, max(queue_date) AS last_seen
        FROM gen_slots
        WHERE answered AND answer_state = 'incorrect' AND dismissed_at IS NULL
        GROUP BY gid
      ),
      gen_expired AS (
        SELECT gid, max(queue_date) AS last_seen
        FROM gen_slots
        WHERE NOT answered AND dismissed_at IS NULL AND queue_date < ${expiredBefore}
        GROUP BY gid
      ),
      gen_dismissed AS (
        SELECT "generatedQuestionId" AS gid FROM "MissedReturnDismissed"
        WHERE "userId" = ${userId} AND "reinstatedAt" IS NULL
          AND "generatedQuestionId" IS NOT NULL
      ),
      gen_unioned AS (
        SELECT gid, 'wrong'::text AS scope, last_seen FROM gen_wrong
        UNION ALL
        SELECT gid, 'expired'::text AS scope, last_seen FROM gen_expired
        WHERE gid NOT IN (SELECT gid FROM gen_wrong)
      ),
      generated_candidates AS (
        SELECT
          'generated'::text            AS kind,
          g.gid                        AS "questionId",
          g.scope                      AS scope,
          g.last_seen                  AS "lastSeenAt",
          COALESCE(s."returnCount", 0) AS "returnCount"
        FROM gen_unioned g
        JOIN "GeneratedQuestion" gq ON gq.id = g.gid
        LEFT JOIN "MissedReturnState" s
          ON s."userId" = ${userId} AND s."generatedQuestionId" = g.gid
        WHERE g.gid NOT IN (SELECT gid FROM gen_ever_correct)
          AND g.gid NOT IN (SELECT gid FROM gen_dismissed)
          AND (s."lastReturnedAt" IS NULL OR s."lastReturnedAt" <= ${cooldownCutoff})
          AND (g.scope <> 'wrong' OR COALESCE(s."returnCount", 0) < ${MISSED_RETURN_LIFETIME_CAP})
      ),
      -- ================= CANONICAL (friend / curated) QUESTIONS =================
      -- (1a) WRONG scope: the player's most recent answer on the question was
      -- incorrect. Read from MASTERY_EVENTS rather than the slots, because a
      -- canonical question can also be answered on the feed and milestone
      -- surfaces, and a wrong answer there deserves to come back too.
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
          AND "questionId" IS NOT NULL
      ),
      -- Wrong takes precedence when a question qualifies under both: it HAS been
      -- seen, so it must carry the return framing and the 3-return cap.
      unioned AS (
        SELECT "questionId", 'wrong'::text AS scope, "lastSeenAt" FROM wrong_scope
        UNION ALL
        SELECT "questionId", 'expired'::text AS scope, "lastSeenAt" FROM expired_scope
        WHERE "questionId" NOT IN (SELECT "questionId" FROM wrong_scope)
      ),
      canonical_candidates AS (
        SELECT
          'canonical'::text                  AS kind,
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
      )
      SELECT kind, "questionId", scope, "lastSeenAt", "returnCount" FROM canonical_candidates
      UNION ALL
      SELECT kind, "questionId", scope, "lastSeenAt", "returnCount" FROM generated_candidates
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `);

    // db.execute returns a driver result ({ rows }) on node-postgres and a bare
    // array on some paths — read both shapes, per the house pattern in
    // domain-fragmentation.ts. Assuming either one alone throws at runtime.
    type Row = {
      kind: ReturnQuestionKind;
      questionId: string;
      scope: ReturnScope;
      lastSeenAt: string | Date;
      returnCount: number;
    };
    const list =
      (rows as unknown as { rows?: Row[] }).rows ?? (rows as unknown as Row[]);

    return list.map((row) => ({
      kind: row.kind,
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
 * "Does this viewer have anything waiting to come back?" — the Home surface's
 * question (§7-E), which needs presence, not the list.
 *
 * Runs the SAME eligibility query with LIMIT 1 rather than a second copy of the
 * rule: duplicating seven conditions into a bespoke EXISTS query would guarantee
 * the two drift apart.
 *
 * Measured on prod, the LIMIT is NOT much of a speed-up — the CTEs materialize
 * before it applies, so it costs ~85-170ms either way (177-candidate account:
 * 170ms full, and agreeing with the full query on every account tested). What it
 * buys is bounded row transfer, and it runs inside Home's existing Promise.all,
 * so it adds parallel time rather than serial. If Home's budget (§12.6, < 1.5s)
 * ever gets tight, this is a real line item — cache it or fold it into an
 * existing query rather than assuming the LIMIT makes it free.
 */
export async function hasEligibleReturnCandidates(userId: string): Promise<boolean> {
  const [first] = await getEligibleReturnCandidates(userId, { limit: 1 });
  return Boolean(first);
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
  target: { kind: ReturnQuestionKind; questionId: string },
  scope: ReturnScope,
  { now = new Date() }: { now?: Date } = {},
): Promise<void> {
  const increment = scope === 'wrong' ? 1 : 0;
  const isCanonical = target.kind === 'canonical';
  try {
    await db
      .insert(missedReturnState)
      .values({
        userId,
        questionId: isCanonical ? target.questionId : null,
        generatedQuestionId: isCanonical ? null : target.questionId,
        lastReturnedAt: now,
        returnCount: increment,
      })
      // The two kinds have separate partial unique indexes (migration 0130), so
      // the conflict target has to name the matching one — a single target
      // covering both columns would never match either index.
      .onConflictDoUpdate({
        target: isCanonical
          ? [missedReturnState.userId, missedReturnState.questionId]
          : [missedReturnState.userId, missedReturnState.generatedQuestionId],
        targetWhere: isCanonical
          ? sql`${missedReturnState.questionId} IS NOT NULL`
          : sql`${missedReturnState.generatedQuestionId} IS NOT NULL`,
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

/**
 * Set the Customize toggle (§7-B1). Upserts so a user who has never opened
 * Customize (and therefore has no DailyPreference row) can still turn the
 * feature off. Deliberately narrow — it touches ONLY this column, so it can
 * never clobber topics, frequency, or difficulty the way a full
 * updateDailyPreferences round-trip could.
 *
 * Materializing a row for a user who had none is safe, and was verified against
 * production: the DB column defaults (difficulty 'adaptive', domain_mode
 * 'random', empty selected_domains / domain_preference_frequency) are exactly
 * what defaultDailyPreferences() synthesizes for a missing row, so
 * getDailyPreferences returns the same values either way. Keep that true — if
 * the two default sets ever diverge, this upsert silently changes behavior for
 * anyone who touches the toggle.
 */
export async function setMissedReturnEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(dailyPreferences)
    .values({ userId, missedReturnEnabled: enabled })
    .onConflictDoUpdate({
      target: dailyPreferences.userId,
      set: { missedReturnEnabled: enabled, updatedAt: new Date() },
    });
}

export type ReturnListItem = {
  kind: ReturnQuestionKind;
  questionId: string;
  scope: ReturnScope;
  questionText: string;
  category: string | null;
  authorName: string | null;
  lastSeenAt: Date;
  returnCount: number;
};

/**
 * The Customize list (§7-D): every question currently eligible to return, in the
 * order they would actually be served, so what the player sees matches what the
 * queue would pick. Both scopes, since one toggle governs both (§7-B1).
 *
 * Dismissed questions are absent, not dimmed — §7-C rules out an archive view,
 * and this list is the lighter surface, not the RecoveredSetAside pattern.
 */
export async function getReturnListForUser(userId: string): Promise<ReturnListItem[]> {
  const candidates = await getEligibleReturnCandidates(userId);
  if (candidates.length === 0) return [];

  const ranked = rankReturnCandidates(candidates);
  const rows = await loadReturnQuestions(ranked);
  // Keyed by kind AND id — the two tables' ids are different namespaces and must
  // never be looked up interchangeably.
  const byKey = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]));
  const authorNames = await resolveCreatorNames(
    rows.map((r) => r.creatorId).filter((id): id is string => Boolean(id)),
  );

  return ranked.flatMap((candidate) => {
    const question = byKey.get(`${candidate.kind}:${candidate.questionId}`);
    if (!question) return [];
    return [
      {
        kind: candidate.kind,
        questionId: candidate.questionId,
        scope: candidate.scope,
        questionText: question.questionText,
        category: question.canonicalSubcategory ?? question.broadCategory ?? null,
        authorName: question.creatorId ? authorNames.get(question.creatorId) ?? null : null,
        lastSeenAt: candidate.lastSeenAt,
        returnCount: candidate.returnCount,
      },
    ];
  });
}

/**
 * Live text for the candidates the builder decided to serve, from BOTH tables.
 *
 * Returns one shape regardless of kind so the slot builder and the Customize
 * list don't each re-branch. Generated questions have no author (LLM origin) and
 * no creator note, which is why those come back null for them rather than being
 * faked — the UI must not imply a person wrote them.
 */
export type LoadedReturnQuestion = {
  kind: ReturnQuestionKind;
  id: string;
  questionText: string;
  creatorId: string | null;
  creatorNote: string | null;
  canonicalSubcategory: string | null;
  broadCategory: string | null;
  category: string | null;
  difficultyEstimate: string | null;
};

export async function loadReturnQuestions(
  targets: readonly { kind: ReturnQuestionKind; questionId: string }[],
): Promise<LoadedReturnQuestion[]> {
  const canonicalIds = targets.filter((t) => t.kind === 'canonical').map((t) => t.questionId);
  const generatedIds = targets.filter((t) => t.kind === 'generated').map((t) => t.questionId);

  const [canonicalRows, generatedRows] = await Promise.all([
    canonicalIds.length
      ? db
          .select({
            id: questions.id,
            questionText: questions.questionText,
            creatorId: questions.creatorId,
            creatorNote: questions.creatorNote,
            canonicalSubcategory: questions.canonicalSubcategory,
            broadCategory: questions.broadCategory,
            category: questions.category,
            difficultyEstimate: questions.difficultyEstimate,
          })
          .from(questions)
          // inArray, not `= ANY(...)`: drizzle renders a JS array in a sql
          // template as a tuple, which Postgres rejects with 42809 against ANY().
          .where(and(inArray(questions.id, canonicalIds), isNull(questions.deletedAt)))
      : Promise.resolve([]),
    generatedIds.length
      ? db
          .select({
            id: generatedQuestions.id,
            questionText: generatedQuestions.questionText,
            canonicalSubcategory: generatedQuestions.canonicalSubcategory,
            broadCategory: generatedQuestions.broadCategory,
            difficultyEstimate: generatedQuestions.difficultyEstimate,
          })
          .from(generatedQuestions)
          .where(inArray(generatedQuestions.id, generatedIds))
      : Promise.resolve([]),
  ]);

  return [
    ...canonicalRows.map((row) => ({ kind: 'canonical' as const, ...row, category: row.category ?? null })),
    ...generatedRows.map((row) => ({
      kind: 'generated' as const,
      id: row.id,
      questionText: row.questionText,
      // LLM origin: no human author, no creator note. Never invent either.
      creatorId: null,
      creatorNote: null,
      canonicalSubcategory: row.canonicalSubcategory,
      broadCategory: row.broadCategory,
      category: null,
      difficultyEstimate: row.difficultyEstimate,
    })),
  ];
}
