ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "answerResult" text;
ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "pointsAwarded" double precision;
ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "masteryDelta" jsonb;
