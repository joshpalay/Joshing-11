-- Migration: precomputed aside ("inside joke") for generated questions.
--
-- B-5 Change 2 extends the "between us" aside to LLM-generated daily questions.
-- The aside is generated once at question-generation time and stored here, then
-- copied into Question.inside_joke when the generated question is persisted —
-- so it is present at first reveal with no user-facing LLM latency.
--
-- Additive nullable column — safe and non-destructive. Older rows (and any where
-- aside generation failed) simply carry NULL and show no aside. An idempotent
-- guard mirroring this statement also lands in src/instrumentation.ts so a
-- preview/production database that records this migration without the column
-- actually present can still boot.
--
-- Rollback: ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS "inside_joke";
-- (drops only the precomputed asides; no other data depends on it.)
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "inside_joke" text;
