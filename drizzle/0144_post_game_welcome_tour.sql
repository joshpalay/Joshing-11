-- Move first-player orientation after the first completed Daily Five and make
-- its one-time state account-scoped. Existing accounts are backfilled as seen
-- so a deploy does not unexpectedly tour established players; accounts created
-- after this migration begin NULL and become eligible after their first round.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcome_tour_seen_at" timestamptz;
--> statement-breakpoint
UPDATE "User"
SET "welcome_tour_seen_at" = NOW()
WHERE "welcome_tour_seen_at" IS NULL;
