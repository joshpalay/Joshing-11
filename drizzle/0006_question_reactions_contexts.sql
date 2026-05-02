ALTER TABLE "QuestionReaction" DROP CONSTRAINT IF EXISTS "QuestionReaction_answer_id_key";
DROP INDEX IF EXISTS "QuestionReaction_answerer_id_idx";
DROP INDEX IF EXISTS "QuestionReaction_creator_id_idx";
DROP INDEX IF EXISTS "QuestionReaction_question_id_idx";
DROP INDEX IF EXISTS "QuestionReaction_game_id_idx";

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

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'creator_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'recipientUserId'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "creator_id" TO "recipientUserId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'question_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'questionId'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "question_id" TO "questionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'game_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'contextId'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "game_id" TO "contextId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'canned_response'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'reactionType'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "canned_response" TO "reactionType";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'note'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'QuestionReaction' AND column_name = 'customMessage'
  ) THEN
    ALTER TABLE "QuestionReaction" RENAME COLUMN "note" TO "customMessage";
  END IF;

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

ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "senderUserId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "recipientUserId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "questionId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "contextType" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "contextId" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "reactionType" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "customMessage" text;
ALTER TABLE "QuestionReaction" ADD COLUMN IF NOT EXISTS "repliedAt" timestamp with time zone;

ALTER TABLE "QuestionReaction" ALTER COLUMN "reactionType" TYPE text USING "reactionType"::text;
UPDATE "QuestionReaction" SET "contextType" = 'joshing_game' WHERE "contextType" IS NULL;
UPDATE "QuestionReaction" SET "reactionType" = 'good_one' WHERE "reactionType" IS NULL;

ALTER TABLE "QuestionReaction" ALTER COLUMN "senderUserId" SET NOT NULL;
ALTER TABLE "QuestionReaction" ALTER COLUMN "recipientUserId" SET NOT NULL;
ALTER TABLE "QuestionReaction" ALTER COLUMN "questionId" SET NOT NULL;
ALTER TABLE "QuestionReaction" ALTER COLUMN "contextType" SET NOT NULL;
ALTER TABLE "QuestionReaction" ALTER COLUMN "contextId" DROP NOT NULL;
ALTER TABLE "QuestionReaction" ALTER COLUMN "reactionType" SET NOT NULL;

ALTER TABLE "QuestionReaction" DROP COLUMN IF EXISTS "answer_id";
ALTER TABLE "QuestionReaction" DROP COLUMN IF EXISTS "creator_response";
ALTER TABLE "QuestionReaction" DROP COLUMN IF EXISTS "parent_reaction_id";

CREATE INDEX IF NOT EXISTS "QuestionReaction_recipientUserId_repliedAt_idx"
  ON "QuestionReaction" ("recipientUserId", "repliedAt");
CREATE INDEX IF NOT EXISTS "QuestionReaction_senderUserId_idx"
  ON "QuestionReaction" ("senderUserId");
CREATE INDEX IF NOT EXISTS "QuestionReaction_questionId_idx"
  ON "QuestionReaction" ("questionId");
CREATE INDEX IF NOT EXISTS "QuestionReaction_context_idx"
  ON "QuestionReaction" ("contextType", "contextId");
