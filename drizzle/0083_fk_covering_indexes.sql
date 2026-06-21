-- Performance: covering indexes for the foreign keys the Supabase performance
-- advisor flags as unindexed (lint 0001_unindexed_foreign_keys). An FK without
-- an index on its own column forces a sequential scan whenever the parent row is
-- updated/deleted (the FK is checked child-side) and on any join/lookup by that
-- column. Zero impact at today's tiny row counts, but a latency landmine at
-- scale and trivially cheap to pre-empt.
--
-- These are the COLD-PATH leftovers. The hot read-path FKs from PERF-FINDINGS-01
-- §1d (FeedItem ×3, ActivityItem) were already indexed; this finishes the list.
--
-- Note on the composite-leading cases: SkippedDailyQuestion already has
-- (user_id, question_id) and (user_id, generated_question_id) composites, and
-- JoshingGameQuestion has a (gameId, questionId) unique — but a composite that
-- LEADS with another column cannot serve a lookup/FK-check on the trailing
-- column alone, so the advisor (correctly) still wants a standalone index on the
-- FK column. These add exactly that.
--
-- Pure index additions — additive, non-destructive, idempotent
-- (CREATE INDEX IF NOT EXISTS). No CONCURRENTLY: the runtime migrator wraps
-- statements in a transaction (CONCURRENTLY is illegal there), matching every
-- existing CREATE INDEX migration in this repo. Mirrored by defensive guards in
-- src/instrumentation.ts (precedent: 0079, 0082) so a preview/production DB that
-- records this migration without the indexes present still gets them on boot.
--
-- Rollback:
--   DROP INDEX IF EXISTS "DAILY_REFINE_DECISION_queue_id_idx";
--   DROP INDEX IF EXISTS "FriendInvitation_inviteeUserId_idx";
--   DROP INDEX IF EXISTS "Friendship_requestedByUserId_idx";
--   DROP INDEX IF EXISTS "Friendship_removedByUserId_idx";
--   DROP INDEX IF EXISTS "JoshingGameQuestion_questionId_idx";
--   DROP INDEX IF EXISTS "JoshingGameResponse_questionId_idx";
--   DROP INDEX IF EXISTS "SkippedDailyQuestion_question_id_idx";
--   DROP INDEX IF EXISTS "SkippedDailyQuestion_generated_question_id_idx";
CREATE INDEX IF NOT EXISTS "DAILY_REFINE_DECISION_queue_id_idx"
  ON "DAILY_REFINE_DECISION" ("queue_id");
CREATE INDEX IF NOT EXISTS "FriendInvitation_inviteeUserId_idx"
  ON "FriendInvitation" ("inviteeUserId");
CREATE INDEX IF NOT EXISTS "Friendship_requestedByUserId_idx"
  ON "Friendship" ("requestedByUserId");
CREATE INDEX IF NOT EXISTS "Friendship_removedByUserId_idx"
  ON "Friendship" ("removedByUserId");
CREATE INDEX IF NOT EXISTS "JoshingGameQuestion_questionId_idx"
  ON "JoshingGameQuestion" ("questionId");
CREATE INDEX IF NOT EXISTS "JoshingGameResponse_questionId_idx"
  ON "JoshingGameResponse" ("questionId");
CREATE INDEX IF NOT EXISTS "SkippedDailyQuestion_question_id_idx"
  ON "SkippedDailyQuestion" ("question_id");
CREATE INDEX IF NOT EXISTS "SkippedDailyQuestion_generated_question_id_idx"
  ON "SkippedDailyQuestion" ("generated_question_id");
