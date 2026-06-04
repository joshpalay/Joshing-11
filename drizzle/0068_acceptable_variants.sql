-- Migration: acceptable answer variants on the machine bank (B4 Phase 4,
-- PRD-D-5 §5.3).
--
-- Adds GeneratedQuestion.acceptable_variants — equivalent phrasings of the answer
-- that the ask-to-answer cold solver produced and the judge accepted. Honored in
-- grading (exact-match fast path) so a right-but-rephrased answer is never marked
-- wrong, and carried to Question.accepted_alternatives when a machine row is
-- promoted to canonical (persistGeneratedQuestion).
--
-- The human-authored table already has accepted_alternatives, so this only adds
-- the machine-side column.
--
-- Additive, IF NOT EXISTS, non-destructive; default empty array. Matching boot
-- guard lands in src/instrumentation.ts.
--
-- Rollback: ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS
-- "acceptable_variants"; nothing else depends on it.
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "acceptable_variants" text[] NOT NULL DEFAULT '{}';
