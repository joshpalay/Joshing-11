-- Separates USER-VISIBLE build latency from TOTAL build latency (Track A, A0a §2).
--
-- WHY. DailyBuildMetric.span_ms measures the whole build. The bonus deferral
-- does not make the bonus work disappear -- it moves it off the player's
-- critical path, to after persistDailyQueue. So span_ms will keep reading the
-- same ~21s it reads today, and the ~15s the deferral buys would be INVISIBLE
-- in the very instrument built to measure it.
--
-- user_visible_ms ends when the queue is persisted and readable. Pre-deferral
-- it equals span_ms; post-deferral the two diverge by exactly the amount
-- deferral bought.
--
-- WHY THAT SHAPE RATHER THAN A BEFORE/AFTER COMPARISON. Production builds ~2
-- queues a day. A before/after across a deploy is confounded by model latency,
-- bank hit rate and domain mix, and would need volume this system does not
-- have. Two columns on ONE row is confound-free and needs no volume at all.
--
-- NULLABLE on purpose: a build that threw, or early-returned on an existing
-- queue / carry-forward, never reached persistence and has no user-visible
-- time. NULL means "did not get there", not zero -- the same rule 0137 applied
-- to target_size, for the same reason: an unwritten value must be visible
-- rather than plausible.
--
-- Rollback:
--   ALTER TABLE "DailyBuildMetric" DROP COLUMN IF EXISTS "user_visible_ms";

ALTER TABLE "DailyBuildMetric"
  ADD COLUMN IF NOT EXISTS "user_visible_ms" integer;
