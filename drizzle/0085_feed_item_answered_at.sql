-- FeedItem.answeredAt — the time the recipient actually answered the card.
--
-- Why this exists: the Answered archive (src/server/db/queries/archive.ts,
-- readFeedItems) sorts feed answers by an "answeredAt" that, until now, fell
-- back to FeedItem.sourceEventAt — the time the question was SENT — whenever it
-- could not find a matching MASTERY_EVENTS row for the feed item. That lookup
-- misses in a normal case (the (source_type, question_id, answered_by_user_id)
-- dedupe in writeMasteryEvent skips a second 'live_correct' event when the user
-- already answered the same canonical question elsewhere), so a card SENT long
-- ago but ANSWERED recently sorted as if it were old and dropped below the
-- 50-item first page of the Answered tab — looking "missing".
--
-- The fix stamps a true answer timestamp on the FeedItem itself, at answer time
-- (feed/answer and lately/milestone/answer), and reads sort/recency from it.
--
-- Additive, nullable, no default — only set when an item is answered. Existing
-- answered rows are backfilled from the matching MASTERY_EVENTS.created_at where
-- one exists (correct/first-time answers); rows with no recoverable event keep
-- NULL and the read still falls back to sourceEventAt, preserving prior behavior
-- for them. All statements idempotent. Mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0084) so a preview/production DB that
-- records this migration without the column present still gets it on next boot.
--
-- Rollback:
--   ALTER TABLE "FeedItem" DROP COLUMN IF EXISTS "answeredAt";

ALTER TABLE "FeedItem"
  ADD COLUMN IF NOT EXISTS "answeredAt" timestamptz;

-- Backfill the answer time from the per-submission MASTERY_EVENTS row. The feed
-- answer pipeline writes answer_id = 'feed:{feedItemId}:{questionId}:{userId}'
-- with session_context = 'feed'; that key uniquely identifies the submission, so
-- this fills one true answer time per recoverable answered item. Only touches
-- NULLs, so it is safe to re-run.
UPDATE "FeedItem" fi
SET "answeredAt" = me."created_at"
FROM "MASTERY_EVENTS" me
WHERE fi."answeredAt" IS NULL
  AND fi."state" = 'answered'
  AND fi."questionId" IS NOT NULL
  AND me."session_context" = 'feed'
  AND me."answer_id" = 'feed:' || fi."id" || ':' || fi."questionId" || ':' || fi."recipientUserId";
