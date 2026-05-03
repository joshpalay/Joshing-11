-- Preview/prod compatibility hotfix for partially-migrated databases.
-- Safe to run repeatedly.

-- 1) MASTERY_EVENTS.metadata was introduced after initial launch.
ALTER TABLE "MASTERY_EVENTS"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- 2) QuestionReaction columns were renamed from snake_case -> camelCase.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'creator_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'recipientUserId'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "creator_id" TO "recipientUserId";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'answerer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'senderUserId'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "answerer_id" TO "senderUserId";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'creator_responded_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'repliedAt'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "creator_responded_at" TO "repliedAt";
  END IF;
END $$;

ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "recipientUserId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "senderUserId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "repliedAt" timestamp with time zone;

-- 3) FeedItem.personalMessage is optional but queried by feed endpoints.
ALTER TABLE "FeedItem"
  ADD COLUMN IF NOT EXISTS "personalMessage" text;
