-- Performance: two composite lookup indexes for hot read paths.
--
-- 1. MASTERY_EVENTS_user_id_source_type_answer_state_created_at_idx
--    Backs the "Lately" convergence lookback (getLatelyConvergences,
--    src/server/db/queries/lately.ts): the query filters equality on user_id,
--    IN-lists on source_type and answer_state, and a created_at range over the
--    60-day window. Only single-column indexes existed (user_id,
--    canonical_subcategory, ...), so Postgres scanned the viewer's whole
--    mastery history and filtered the rest in the heap. The composite narrows
--    to the matching (user, source, state) prefix and orders by created_at.
--
-- 2. Follow_followerId_followeeId_state_idx
--    A covering index for the friends-visibility EXISTS subquery on the
--    read-hot feed path (questionVisibilityPredicate, src/server/db/queries/
--    feed.ts): "does the viewer follow this question's author with
--    state=approved?". The existing UNIQUE (followerId, followeeId) already
--    pinpoints the single row; adding state lets the approved-state check be
--    answered index-only (no heap visit) on every feed render.
--
-- Both are pure index additions — additive, non-destructive, and idempotent
-- (CREATE INDEX IF NOT EXISTS). No CONCURRENTLY: the runtime migrator wraps
-- statements in a transaction (CONCURRENTLY is illegal there), matching every
-- existing CREATE INDEX migration in this repo. Mirrored by defensive guards
-- in src/instrumentation.ts (precedent: 0074's domain_key index guard) so a
-- preview/production database that records this migration without the indexes
-- present still gets them on next boot.
--
-- Rollback:
--   DROP INDEX IF EXISTS "MASTERY_EVENTS_user_id_source_type_answer_state_created_at_idx";
--   DROP INDEX IF EXISTS "Follow_followerId_followeeId_state_idx";
CREATE INDEX IF NOT EXISTS "MASTERY_EVENTS_user_id_source_type_answer_state_created_at_idx"
  ON "MASTERY_EVENTS" ("user_id", "source_type", "answer_state", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Follow_followerId_followeeId_state_idx"
  ON "Follow" ("followerId", "followeeId", "state");
