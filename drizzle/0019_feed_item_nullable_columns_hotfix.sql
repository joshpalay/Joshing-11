-- Ensure nullable FeedItem columns queried by the feed API exist on partially-migrated databases.
ALTER TABLE "FeedItem"
  ADD COLUMN IF NOT EXISTS "personalMessage" text,
  ADD COLUMN IF NOT EXISTS "sourceResult" text,
  ADD COLUMN IF NOT EXISTS "submittedAnswer" text,
  ADD COLUMN IF NOT EXISTS "quip" text;
