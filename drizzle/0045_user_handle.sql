-- Migration: introduce per-user public handle.
--
-- Required for invite links (/invite/<handle>/<token>) and exact-handle
-- search. Nullable for now: a follow-up migration will tighten to NOT NULL
-- once backfill is complete and signup is gated on entering a handle.
-- The unique-lower index prevents 'Robyn' and 'robyn' from coexisting.
--
-- handle_last_changed_at gates the 30-day rate limit on handle changes
-- (PATCH /api/account/handle). NULL on freshly-backfilled rows is treated
-- as 'never changed', so the first user-initiated change is always allowed.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the columns actually present.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "handle" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_handle_lower"
  ON "User" (LOWER("handle")) WHERE "handle" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "handle_last_changed_at" timestamptz;
