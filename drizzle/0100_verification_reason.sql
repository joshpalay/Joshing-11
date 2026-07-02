-- 0100_verification_reason (B-CRAFTER-LIFECYCLE-01 Phase 1)
--
-- The batch verifier (batch-verify-questions) returns a short verdict reason
-- ("names the specific error, or 'verified', or what could not be settled") but
-- until now discarded it — only verification_verdict + verified_at were stamped.
-- The admin review queue's machine-demotion cards need that reason (it plays the
-- role the reporter's note plays on player-report cards), so persist it on both
-- question stores. Additive, nullable, no backfill: rows verified before this
-- migration keep NULL and the UI renders "reason not captured".
--
-- Rollback: ALTER TABLE "Question" DROP COLUMN "verification_reason";
--           ALTER TABLE "GeneratedQuestion" DROP COLUMN "verification_reason";
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "verification_reason" text;--> statement-breakpoint
ALTER TABLE "GeneratedQuestion" ADD COLUMN IF NOT EXISTS "verification_reason" text;
