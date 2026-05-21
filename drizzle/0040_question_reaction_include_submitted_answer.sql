-- Migration: §8.22 wrong-answer text visibility — opt-in flag on reactions.
--
-- Adds include_submitted_answer to QuestionReaction. When an answerer sends
-- a wrong-answer reaction with this flag = true, the activity-feed read
-- layer joins their submitted_answer into the payload that reaches the
-- question's author. Default false; existing rows preserve the §8.22
-- default that submitted text does NOT reach the author.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the column actually present.
ALTER TABLE "QuestionReaction"
  ADD COLUMN IF NOT EXISTS "includeSubmittedAnswer" boolean NOT NULL DEFAULT false;
