-- Performance: covering indexes for four hot-path foreign keys (B-PERF-03).
--
-- These FKs sit directly on the Feed-load and From-Friends read paths but had
-- no backing index, so lookups/joins on them and FK-cascade checks fall back to
-- sequential scans. Zero impact today (tables are tiny) but latency landmines
-- at scale — trivially cheap to add now.
--
--   FeedItem.questionId      -> joins to Question on feed assembly
--   FeedItem.sourceUserId    -> "from friends" attribution lookups
--   FeedItem.joshingGameId   -> game-linked feed items
--   ActivityItem.actorUserId -> activity actor resolution / ON DELETE SET NULL
--
-- Pure index additions — additive, non-destructive, idempotent
-- (CREATE INDEX IF NOT EXISTS). No CONCURRENTLY: the runtime migrator wraps
-- statements in a transaction (CONCURRENTLY is illegal there), matching every
-- existing CREATE INDEX migration in this repo. Mirrored by defensive guards in
-- src/instrumentation.ts (precedent: 0078) so a preview/production database
-- that records this migration without the indexes present still gets them on
-- next boot.
--
-- Rollback:
--   DROP INDEX IF EXISTS "FeedItem_questionId_idx";
--   DROP INDEX IF EXISTS "FeedItem_sourceUserId_idx";
--   DROP INDEX IF EXISTS "FeedItem_joshingGameId_idx";
--   DROP INDEX IF EXISTS "ActivityItem_actorUserId_idx";
CREATE INDEX IF NOT EXISTS "FeedItem_questionId_idx"
  ON "FeedItem" ("questionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedItem_sourceUserId_idx"
  ON "FeedItem" ("sourceUserId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedItem_joshingGameId_idx"
  ON "FeedItem" ("joshingGameId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ActivityItem_actorUserId_idx"
  ON "ActivityItem" ("actorUserId");
