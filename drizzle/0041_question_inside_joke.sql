-- 0039: friends-only "inside joke" field on Question.
-- LLM-generated during question creation, displayed on the answer reveal
-- only to the question's creator and their friends.
--
-- Idempotent guard is pre-applied in src/instrumentation.ts so partially
-- recorded preview/production databases heal on boot.
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "inside_joke" text;
