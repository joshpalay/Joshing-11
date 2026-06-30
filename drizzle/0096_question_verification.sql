-- B-QUESTION-QUALITY-AGENTS-01 Phase 1 — verification stamp columns + demote enum.
--
-- Adds the batch-verification substrate (no behaviour change): a verdict enum, a
-- nullable stamp on BOTH question stores, and the demote-target public status.
--   - QuestionVerificationVerdict: ok | demoted | unverifiable | skipped.
--   - PublicStatus gains 'needs_review' — the demote target for a caught Question
--     (Decision A; the enum had no such value, so this realizes the ratified intent).
--   - Question + GeneratedQuestion each get verified_at + verification_verdict.
--     Both stores are swept (Decision: cover both); a stamped row is never
--     re-processed. GeneratedQuestion demotes via its existing is_duplicate flag.
--
-- Purely additive and nullable: no existing column is touched, no default backfills
-- a value, so every existing row reads exactly as before. Idempotent and mirrored
-- by a defensive guard in src/instrumentation.ts (precedent: the territory_type +
-- DomainExclusionScope guards). ALTER TYPE ... ADD VALUE is not used in this same
-- migration, so it is transaction-safe on PG 12+.
--
-- Rollback:
--   ALTER TABLE "Question" DROP COLUMN IF EXISTS "verification_verdict";
--   ALTER TABLE "Question" DROP COLUMN IF EXISTS "verified_at";
--   ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS "verification_verdict";
--   ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS "verified_at";
--   -- (enum values + types are left in place; dropping an enum value is unsupported.)
DO $$ BEGIN
  CREATE TYPE "public"."QuestionVerificationVerdict" AS ENUM('ok', 'demoted', 'unverifiable', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."PublicStatus" ADD VALUE IF NOT EXISTS 'needs_review';
--> statement-breakpoint
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "verification_verdict" "public"."QuestionVerificationVerdict";
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "verification_verdict" "public"."QuestionVerificationVerdict";
