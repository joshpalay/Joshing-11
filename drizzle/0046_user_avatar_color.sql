-- Migration: persist a deterministic avatar color per user.
--
-- Today src/components/feed/visual.ts derives avatar color on the fly from
-- a hash of the user id. Persisting it gives future avatar-customization
-- UI a place to write, and lets us render the chip without recomputing the
-- hash on every page load.
--
-- The backfill script must use the existing colorForUser() helper so that
-- already-rendered avatars don't visibly change color when this column
-- starts being read.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the column actually present.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "avatar_color" text;
