-- Migration: ask-to-answer verification record (B4 Phase 1, PRD-D-5 §5.3 layer 2).
--
-- Adds GeneratedQuestion.ask_to_answer_verified — true when an independent cold
-- solver (Haiku, separate from the Sonnet generator) corroborated the stored
-- answer at generation time. Together with B3 retrieval corroboration this is
-- what earns the machine_verified trust tier (see resolveMachineTrustTier in
-- src/server/daily/ask-to-answer.ts).
--
-- Only the machine bank gets this column: human-authored questions are
-- author_confirmed by their author and never pass through ask-to-answer.
--
-- Additive, IF NOT EXISTS, non-destructive. Existing rows default false; the B1
-- grandfather backfill already promoted the pre-existing machine backlog to
-- machine_verified, so a false here does not demote anything. Matching idempotent
-- boot guard lands in src/instrumentation.ts.
--
-- Rollback: ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS
-- "ask_to_answer_verified"; nothing else depends on it.
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "ask_to_answer_verified" boolean NOT NULL DEFAULT false;
