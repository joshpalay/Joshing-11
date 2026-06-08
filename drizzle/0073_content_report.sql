-- B-Report-1 — Content Reporting substrate.
--
-- Adds the ContentReport table plus its three enums. Purely additive: no
-- existing table is altered and nothing here is wired to a surface yet
-- (B-Report-2 onward does the wiring). The table mirrors two existing
-- patterns in schema.ts:
--   * GradeDispute lifecycle — status enum + review_decision / review_reason
--     / reviewed_at columns that a reviewer stamps when resolving a report.
--   * QuestionFeedback dual-FK — a report targets exactly one of a curated
--     Question or a generated GeneratedQuestion via two nullable FK columns.
--
-- Two CHECK constraints encode the invariants:
--   * ContentReport_one_target           — exactly one of the two target FKs is set.
--   * ContentReport_incorrect_kind_scope — incorrect_kind only when category = 'incorrect'.
--
-- "One open report per user per target" is enforced with two partial UNIQUE
-- indexes (the target is split across two nullable columns, so a single
-- COALESCE index isn't expressible). Each is scoped to status = 'open', so a
-- fresh report is permitted once a prior one resolves (re-report policy).
--
-- Every statement is idempotent (DO $$ … duplicate_object for enums,
-- IF NOT EXISTS for the table / constraints / indexes) and is mirrored by a
-- defensive guard in src/instrumentation.ts so a preview/production database
-- that records this migration without the objects present still boots.
--
-- Rollback:
--   DROP TABLE IF EXISTS "ContentReport";
--   DROP TYPE  IF EXISTS "ContentReportStatus";
--   DROP TYPE  IF EXISTS "ContentReportIncorrectKind";
--   DROP TYPE  IF EXISTS "ContentReportCategory";
DO $$ BEGIN
  CREATE TYPE "public"."ContentReportCategory" AS ENUM('incorrect', 'inappropriate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ContentReportIncorrectKind" AS ENUM('answer_key', 'premise');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ContentReportStatus" AS ENUM('open', 'upheld', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ContentReport" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "reporter_user_id" text NOT NULL,
  "question_id" text,
  "generated_question_id" text,
  "category" "public"."ContentReportCategory" NOT NULL,
  "incorrect_kind" "public"."ContentReportIncorrectKind",
  "note" text NOT NULL,
  "suggested_answer" text,
  "surface" text,
  "status" "public"."ContentReportStatus" NOT NULL DEFAULT 'open',
  "review_decision" text,
  "review_reason" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ContentReport_one_target"
    CHECK ((question_id IS NOT NULL)::int + (generated_question_id IS NOT NULL)::int = 1),
  CONSTRAINT "ContentReport_incorrect_kind_scope"
    CHECK (incorrect_kind IS NULL OR category = 'incorrect')
);
--> statement-breakpoint
DO $$
DECLARE
  report_table regclass := to_regclass('public."ContentReport"');
  user_table regclass := to_regclass('public."User"');
  question_table regclass := to_regclass('public."Question"');
  generated_question_table regclass := to_regclass('public."GeneratedQuestion"');
BEGIN
  IF report_table IS NOT NULL
    AND user_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ContentReport_reporter_user_id_User_id_fk'
        AND conrelid = report_table
    )
  THEN
    ALTER TABLE "ContentReport"
      ADD CONSTRAINT "ContentReport_reporter_user_id_User_id_fk"
      FOREIGN KEY ("reporter_user_id") REFERENCES "User"("id");
  END IF;

  IF report_table IS NOT NULL
    AND question_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ContentReport_question_id_Question_id_fk'
        AND conrelid = report_table
    )
  THEN
    ALTER TABLE "ContentReport"
      ADD CONSTRAINT "ContentReport_question_id_Question_id_fk"
      FOREIGN KEY ("question_id") REFERENCES "Question"("id");
  END IF;

  IF report_table IS NOT NULL
    AND generated_question_table IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ContentReport_generated_question_id_GeneratedQuestion_id_fk'
        AND conrelid = report_table
    )
  THEN
    ALTER TABLE "ContentReport"
      ADD CONSTRAINT "ContentReport_generated_question_id_GeneratedQuestion_id_fk"
      FOREIGN KEY ("generated_question_id") REFERENCES "GeneratedQuestion"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ContentReport_reporter_user_id_idx"
  ON "ContentReport" ("reporter_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ContentReport_question_id_idx"
  ON "ContentReport" ("question_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ContentReport_generated_question_id_idx"
  ON "ContentReport" ("generated_question_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ContentReport_status_idx"
  ON "ContentReport" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ContentReport_one_open_per_question"
  ON "ContentReport" ("reporter_user_id", "question_id")
  WHERE status = 'open' AND question_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ContentReport_one_open_per_generated_question"
  ON "ContentReport" ("reporter_user_id", "generated_question_id")
  WHERE status = 'open' AND generated_question_id IS NOT NULL;
