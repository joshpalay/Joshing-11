-- Migration: add CHECK constraint on FeedItem.sourceResult to enforce enum values.
-- The TypeScript schema already declares .$type<'correct' | 'incorrect' | null>();
-- this constraint enforces it at the DB level so invalid strings can never be persisted.
ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_sourceResult_check"
  CHECK ("sourceResult" IN ('correct', 'incorrect') OR "sourceResult" IS NULL);
