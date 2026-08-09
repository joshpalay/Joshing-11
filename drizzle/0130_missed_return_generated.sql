-- 0130: let the missed-question return system carry LLM-generated questions,
-- not just canonical ones (D-MISSED-RETURN-01, gap found 2026-08-09).
--
-- THE GAP. Both MissedReturnDismissed and MissedReturnState keyed only
-- "questionId" -> Question(id). But an LLM-origin daily question lives in
-- GeneratedQuestion, and MASTERY_EVENTS.question_id is NULL for those rows (the
-- writer only ever stores eventQuestionId, which is canonical-only). So a
-- generated question could never become a return candidate. Measured on prod,
-- that excluded the overwhelming majority of the actual inventory:
--
--     kind                        answered wrong   expired unanswered   users
--     canonical (friend/curated)              15                  166      14
--     generated (LLM)                        357                  101      22
--
-- i.e. ~96% of wrong answers inside the Daily Five were unreachable. Catch-up
-- ("Play Missed Questions") already serves both kinds, so the return slot must
-- too, or it returns almost nothing anyone actually missed.
--
-- THE SHAPE. Mirrors the discriminated pattern the codebase already uses for
-- exactly this ambiguity — CatchupQueueItem.reportTarget and DailyQueue.slots,
-- both of which carry `question_id` XOR `generated_question_id`. "questionId"
-- becomes nullable, "generatedQuestionId" is added, and a CHECK enforces that
-- exactly one is set so a row can never be ambiguous or empty.
--
-- The partial unique indexes are split per kind: the existing canonical index
-- keeps its name and gains a "questionId IS NOT NULL" guard (a partial unique
-- index over a nullable column would otherwise let unlimited generated rows
-- collide on (userId, NULL)), and a matching one is added for the generated kind.
--
-- Additive and safe on the existing rows: every row written before this
-- migration has a non-null questionId, which satisfies the CHECK unchanged.
--
-- Rollback:
--   DELETE FROM "MissedReturnDismissed" WHERE "generatedQuestionId" IS NOT NULL;
--   DELETE FROM "MissedReturnState"     WHERE "generatedQuestionId" IS NOT NULL;
--   ALTER TABLE "MissedReturnDismissed" DROP CONSTRAINT IF EXISTS "MissedReturnDismissed_one_target";
--   ALTER TABLE "MissedReturnState"     DROP CONSTRAINT IF EXISTS "MissedReturnState_one_target";
--   ALTER TABLE "MissedReturnDismissed" DROP COLUMN IF EXISTS "generatedQuestionId";
--   ALTER TABLE "MissedReturnState"     DROP COLUMN IF EXISTS "generatedQuestionId";
--   -- then restore the NOT NULL on "questionId" and the original unique indexes.
ALTER TABLE "MissedReturnDismissed"
  ADD COLUMN IF NOT EXISTS "generatedQuestionId" text
  REFERENCES "GeneratedQuestion"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "MissedReturnState"
  ADD COLUMN IF NOT EXISTS "generatedQuestionId" text
  REFERENCES "GeneratedQuestion"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "MissedReturnDismissed" ALTER COLUMN "questionId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "MissedReturnState" ALTER COLUMN "questionId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "MissedReturnDismissed" DROP CONSTRAINT IF EXISTS "MissedReturnDismissed_one_target";
--> statement-breakpoint
ALTER TABLE "MissedReturnDismissed"
  ADD CONSTRAINT "MissedReturnDismissed_one_target"
  CHECK (("questionId" IS NOT NULL) <> ("generatedQuestionId" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "MissedReturnState" DROP CONSTRAINT IF EXISTS "MissedReturnState_one_target";
--> statement-breakpoint
ALTER TABLE "MissedReturnState"
  ADD CONSTRAINT "MissedReturnState_one_target"
  CHECK (("questionId" IS NOT NULL) <> ("generatedQuestionId" IS NOT NULL));
--> statement-breakpoint
DROP INDEX IF EXISTS "missed_return_dismissed_active_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_dismissed_active_unique"
  ON "MissedReturnDismissed" ("userId", "questionId")
  WHERE "reinstatedAt" IS NULL AND "questionId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_dismissed_generated_active_unique"
  ON "MissedReturnDismissed" ("userId", "generatedQuestionId")
  WHERE "reinstatedAt" IS NULL AND "generatedQuestionId" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "missed_return_state_user_question_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_state_user_question_unique"
  ON "MissedReturnState" ("userId", "questionId")
  WHERE "questionId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_return_state_user_generated_unique"
  ON "MissedReturnState" ("userId", "generatedQuestionId")
  WHERE "generatedQuestionId" IS NOT NULL;
