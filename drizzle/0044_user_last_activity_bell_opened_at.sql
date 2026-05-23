-- Migration: bell-badge unseen tracking — when did this user last open the
-- activity bell?
--
-- Adds nullable last_activity_bell_opened_at to User. Used by
-- getBellBadgeCount to count ActivityItem rows that fired AFTER the bell
-- was last opened AND are not currently visible on Home's top-3 rail.
-- Nullable so existing users start at 'never opened' (which the count
-- query treats as "everything since 1970"; the NOT-IN top-3 filter keeps
-- the visible noise pinned to zero on first surface).
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the column actually present.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "last_activity_bell_opened_at" timestamp with time zone;
