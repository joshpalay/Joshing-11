-- Two-phase build metric + deferred flag (Track A, deferral B').
--
-- WHY TWO PHASES. The bonus deferral moves bonus generation AFTER the queue is
-- persisted, into a scheduled continuation. The metric row used to be written
-- once, when the build resolved. Post-deferral that is the wrong moment twice
-- over:
--   * write it at persist and span_ms excludes the bonus work, so span_ms and
--     user_visible_ms are equal on every row and the deferral measures ZERO --
--     a plausible, wrong, unfalsifiable answer;
--   * write it only in the continuation and a dropped continuation (serverless
--     freeze after response, a throw, a path where after() does not run) leaves
--     NO ROW AT ALL, which is ambiguous between "the build never happened" and
--     "the continuation was lost".
--
-- So: INSERT at persist with user_visible_ms set and span_ms NULL, then UPDATE
-- in the continuation with span_ms and the bonus-phase round span. The row
-- always exists; a lost continuation shows as span_ms IS NULL, which is a
-- visible signal rather than a missing row. Same rule already applied to
-- target_size (0137) and user_visible_ms (0138): an unwritten value must be
-- visible, not plausible.
--
-- WHY `deferred`. After the deferral ships, cron builds run deferred while any
-- caller without a request scope (no after()) falls back to running inline.
-- Both write rows, and an inline row has span_ms ~ user_visible_ms -- the same
-- signature as a pre-deferral row AND as a failed deferral. Three states, one
-- reading. This flag separates them. NULL means the build predates the flag.
--
-- Rollback:
--   ALTER TABLE "DailyBuildMetric" DROP COLUMN IF EXISTS "deferred";
--   UPDATE "DailyBuildMetric" SET "span_ms" = 0 WHERE "span_ms" IS NULL;
--   ALTER TABLE "DailyBuildMetric" ALTER COLUMN "span_ms" SET NOT NULL;

ALTER TABLE "DailyBuildMetric"
  ALTER COLUMN "span_ms" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "DailyBuildMetric"
  ADD COLUMN IF NOT EXISTS "deferred" boolean;
