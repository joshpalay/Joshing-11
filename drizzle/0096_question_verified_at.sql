-- D-QUESTION-QUALITY-AGENTS-01 — batch-verification stamp.
-- Adds verified_at (one-per-question lifetime stamp; nightly sweep skips stamped
-- rows) and verification_verdict (enum: ok | demoted | unverifiable | skipped).
DO $$ BEGIN
  CREATE TYPE "public"."VerificationVerdict" AS ENUM('ok', 'demoted', 'unverifiable', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "verification_verdict" "public"."VerificationVerdict";
