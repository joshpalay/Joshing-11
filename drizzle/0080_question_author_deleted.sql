-- Account-deletion territory (D-ACCOUNT-DELETION-TERRITORY-01).
--
-- Adds Question.author_deleted: the tombstone marker that distinguishes a
-- question whose human author deleted their account (now re-sourced to the
-- house/editorial identity per A1) from a genuine house-authored question.
--
-- When an author deletes, a Question that any RETAINED user has proven
-- territory on (a MASTERY_EVENTS row, a UserQuestionBank save, a
-- JoshingGameResponse, or a FeedItem on a retained feed) is NOT hard-deleted —
-- it is tombstoned: creator_id -> NULL, source -> 'house_authored',
-- author_deleted -> true, content/asked_count/correct_count retained so the
-- answerers' difficulty + proven-territory math and §8.27 retroactive
-- reclassification keep working. The boolean lets render/query paths tell a
-- tombstone apart from a born-house question (which has author_deleted = false).
-- Invariant H-1 still holds: a tombstone never renders as a person.
--
-- Additive, non-destructive, idempotent (ADD COLUMN IF NOT EXISTS, NOT NULL
-- DEFAULT false). Mirrored by a defensive guard in src/instrumentation.ts
-- (precedent: 0077's opt_in_on_confirm) so a preview/production database that
-- records this migration without the column present still gets it on next boot.
--
-- Rollback:
--   ALTER TABLE "Question" DROP COLUMN IF EXISTS "author_deleted";
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "author_deleted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Partial index for the tombstone-aware render/query paths: the flag is true for
-- a tiny minority of rows, so a partial index keeps any "is this a tombstone"
-- filter cheap (precedent: Question_nobody_correct_flag_idx).
CREATE INDEX IF NOT EXISTS "Question_author_deleted_idx"
  ON "Question" ("author_deleted")
  WHERE "author_deleted" = true;
