ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "sourceAnswerId" text;

CREATE UNIQUE INDEX IF NOT EXISTS "FeedItem_recipientUserId_sourceAnswerId_key"
  ON "FeedItem" ("recipientUserId", "sourceAnswerId")
  WHERE "sourceAnswerId" IS NOT NULL;

-- Feed items caused by question authorship/publication are no longer valid main-feed material.
-- The underlying questions stay intact, and answer-based social feed events are preserved.
UPDATE "FeedItem"
SET "state" = 'rolled_off'
WHERE "sourceType" IN ('authored_shared', 'thumbs_upped')
  AND "state" IN ('active', 'skipped');

-- Incorrect answers are intentionally private/review-only and should not remain normal Feed cards.
UPDATE "FeedItem"
SET "state" = 'rolled_off'
WHERE "sourceType" = 'friend_answered'
  AND COALESCE("sourceResult", '') <> 'correct'
  AND "state" IN ('active', 'skipped');
