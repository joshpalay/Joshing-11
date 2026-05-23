-- The "season_points_start" column was originally intended as a per-season
-- baseline that would reset at each season boundary. That reset logic was
-- never ported to Drizzle/v11.0 (see _salvaged/season-snapshot.ts for the
-- deprecated v10.25 intent). In practice the column only ever mutates during
-- domain merges (src/server/mastery/ceremony.ts), where the values across
-- merged rows are summed and preserved on the surviving row — i.e. it is a
-- frozen lifetime baseline, not a season-scoped one. Rename it so the column
-- name matches actual behavior.
--
-- Idempotent: the rename is wrapped in an information_schema check so
-- re-running this migration (or applying it against a DB where the rename
-- already landed via the instrumentation guard) is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PLAYER_MASTERY'
      AND column_name = 'season_points_start'
  ) THEN
    ALTER TABLE "PLAYER_MASTERY"
      RENAME COLUMN "season_points_start" TO "lifetime_points_baseline";
  END IF;
END $$;
