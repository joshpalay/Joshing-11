-- Migration: human-play trust promotion back-fill + "nobody got it" flag
-- (B4 Phase 2, PRD-D-5 §5.3 layer 3 / §6 / §7).
--
-- 1. Adds Question.nobody_correct_flag (the review smell; never auto-deletes).
-- 2. Corrects a B1 grandfather artifact: migration 0062 promoted ALL existing
--    Question rows to author_confirmed, including null-creator daily_generated
--    rows that are machine-origin, not author-asserted. author_confirmed is a
--    friend-facing + public-per-D9 tier that must mean "a human authored this",
--    so machine-origin rows are corrected back to machine_verified BEFORE the
--    human_validated back-fill (so they become eligible for it).
-- 3. Back-fills human_validated for questions whose play history already meets
--    the §7 threshold (N=3 distinct humans correct), Drift Risk 1 step 1.
-- 4. Back-fills the nobody_correct_flag for questions ≥5 distinct holders tried
--    with zero correct.
--
-- "Correct" = any non-incorrect MASTERY_EVENTS.answer_state. An answerer may have
-- more than one row per question (the unique key includes source_type), so
-- count(DISTINCT answered_by_user_id) is what collapses them to distinct humans.
--
-- Additive + idempotent (column IF NOT EXISTS; UPDATEs are re-runnable, each
-- guarded on the source tier / current flag). Matching boot guards land in
-- src/instrumentation.ts. Emits RAISE NOTICE counts for the Phase 2 checkpoint
-- report.
--
-- Rollback: ALTER TABLE "Question" DROP COLUMN IF EXISTS "nobody_correct_flag".
-- The trust_tier corrections are not auto-reverted (they restore correct
-- semantics); no other data depends on the flag column.
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "nobody_correct_flag" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Correct mis-grandfathered machine-origin rows (null author, daily_generated).
UPDATE "Question"
  SET "trust_tier" = 'machine_verified'
  WHERE "creator_id" IS NULL
    AND "source" = 'daily_generated'
    AND "trust_tier" = 'author_confirmed';
--> statement-breakpoint
-- Promote machine_verified rows that already have ≥3 distinct humans correct.
UPDATE "Question" q
  SET "trust_tier" = 'human_validated'
  WHERE q."trust_tier" = 'machine_verified'
    AND q."id" IN (
      SELECT m."question_id"
      FROM "MASTERY_EVENTS" m
      WHERE m."question_id" IS NOT NULL
        AND m."answer_state" IN ('first_correct', 'first_correct_after_wrong', 'repeat_correct')
      GROUP BY m."question_id"
      HAVING count(DISTINCT m."answered_by_user_id") >= 3
    );
--> statement-breakpoint
-- Flag "nobody got it" rows: ≥5 distinct holders answered, none correctly.
UPDATE "Question" q
  SET "nobody_correct_flag" = true
  WHERE q."nobody_correct_flag" = false
    AND q."id" IN (
      SELECT m."question_id"
      FROM "MASTERY_EVENTS" m
      WHERE m."question_id" IS NOT NULL
        AND m."answer_state" IS NOT NULL
      GROUP BY m."question_id"
      HAVING count(DISTINCT m."answered_by_user_id") >= 5
        AND count(DISTINCT m."answered_by_user_id") FILTER (
          WHERE m."answer_state" IN ('first_correct', 'first_correct_after_wrong', 'repeat_correct')
        ) = 0
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Question_nobody_correct_flag_idx"
  ON "Question" ("nobody_correct_flag") WHERE "nobody_correct_flag" = true;
--> statement-breakpoint
-- Checkpoint report (visible in migration logs).
DO $$
DECLARE
  v_human_validated bigint;
  v_machine_verified bigint;
  v_author_confirmed bigint;
  v_nobody_flagged bigint;
BEGIN
  SELECT count(*) INTO v_human_validated FROM "Question" WHERE "trust_tier" = 'human_validated';
  SELECT count(*) INTO v_machine_verified FROM "Question" WHERE "trust_tier" = 'machine_verified';
  SELECT count(*) INTO v_author_confirmed FROM "Question" WHERE "trust_tier" = 'author_confirmed';
  SELECT count(*) INTO v_nobody_flagged FROM "Question" WHERE "nobody_correct_flag" = true;
  RAISE NOTICE 'B4 Phase 2 back-fill: Question human_validated=%, machine_verified=%, author_confirmed=%, nobody_correct_flag=%',
    v_human_validated, v_machine_verified, v_author_confirmed, v_nobody_flagged;
END $$;
