-- Weekly friends email (notifications option C).
--
-- weekly_digest_opt_in: the player's own switch for the Sunday "what your
-- friends did this week" email. Defaults ON, but the email only ever goes to a
-- CONFIRMED address whose owner hasn't unsubscribed (email_opt_in <> 'opted_out')
-- — confirming an address is the consent moment; this column lets someone keep
-- the daily email and drop the weekly one (or the reverse).
--
-- weekly_digest_sent_at: when the last weekly email went out. The cron claims a
-- row by moving this forward atomically, so a retried or overlapping run can't
-- send the same week twice.
--
-- Both additive; metadata-only on Postgres 11+ (constant default, no rewrite).
--
-- Rollback:
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "weekly_digest_sent_at";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "weekly_digest_opt_in";

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weekly_digest_opt_in" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weekly_digest_sent_at" timestamp with time zone;
