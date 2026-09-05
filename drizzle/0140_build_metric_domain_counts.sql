-- Separates the deferral's two modes at the source (Track A, deferral B').
--
-- WHY. user_visible_ms is BIMODAL after the deferral, and the two modes are
-- easy to misread as a broken deferral:
--   * happy path -- the core slice delivers, bonus is deferred, user_visible_ms
--     is small and its gap to span_ms is the prize;
--   * miss path -- the core slice under-delivers, bonus domains are BORROWED
--     BACK and generated synchronously to protect the five, so their cost lands
--     in user_visible_ms and the gap shrinks toward zero.
-- The second is correct behaviour (a short queue is worse than a slow one) but
-- it looks exactly like a deferral that bought nothing. borrowed_domain_count
-- separates them at the source instead of by inference.
--
-- deferred_domain_count closes the other reading. `deferred` is false both when
-- there was no request scope (after() unavailable, tail ran inline) and when
-- there was simply nothing to defer -- every bonus domain having been borrowed
-- back, or none existing. Those are different builds:
--     deferred=false, deferred_domain_count > 0  -> no request scope
--     deferred=false, deferred_domain_count = 0  -> nothing to defer
--
-- NULLABLE, like every other field added in this series: an unwritten value
-- must be visible, not plausible. NULL means the row predates these columns.
--
-- Rollback:
--   ALTER TABLE "DailyBuildMetric" DROP COLUMN IF EXISTS "borrowed_domain_count";
--   ALTER TABLE "DailyBuildMetric" DROP COLUMN IF EXISTS "deferred_domain_count";

ALTER TABLE "DailyBuildMetric"
  ADD COLUMN IF NOT EXISTS "borrowed_domain_count" integer;
--> statement-breakpoint
ALTER TABLE "DailyBuildMetric"
  ADD COLUMN IF NOT EXISTS "deferred_domain_count" integer;
