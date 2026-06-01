-- Migration: retire the relational CreatorNote table and the dead per-answer
-- "quip" columns (B-3 — consolidate commentary onto Question.creator_note).
--
-- The post-wrong-answer CreatorNote nudge is retired in favor of the canonical
-- at-creation "author's why" (Question.creator_note), which is now surfaced on
-- answer. The auto-generated consolation "quip" columns are retired alongside
-- it. The matching idempotent guards have been removed from
-- src/instrumentation.ts in the same change.
--
-- Destructive drops, guarded with IF EXISTS so they are safe to re-run and safe
-- on databases where the objects were never created. The SmsMessageType enum
-- values 'creator_note_prompt' / 'creator_note_received' are intentionally left
-- in place — Postgres cannot cleanly drop enum values — but no code emits them.
DROP TABLE IF EXISTS "CreatorNote";
--> statement-breakpoint
ALTER TABLE "FeedItem" DROP COLUMN IF EXISTS "quip";
--> statement-breakpoint
ALTER TABLE "JoshingGameResponse" DROP COLUMN IF EXISTS "quip";
