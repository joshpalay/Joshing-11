-- Track when a wrong feed answer was recovered through the catch-up flow.
-- Catch-up surfaces feed items where state = 'answered' AND answerResult =
-- 'incorrect' AND catchupResolvedAt IS NULL. Setting this timestamp removes
-- the feed item from catch-up without altering the feed history (so the
-- recipient still sees "you answered this wrong" on the feed card itself).
--
-- Idempotent guard is pre-applied in src/instrumentation.ts for preview/
-- production databases that may have this migration recorded without the
-- column actually present.
ALTER TABLE "FeedItem"
  ADD COLUMN IF NOT EXISTS "catchupResolvedAt" timestamptz;
