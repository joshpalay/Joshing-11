-- Auditable SMS reminder consent plus per-day delivery idempotency.
--
-- The User columns record the latest opt-in and opt-out timestamps together
-- with the web-form source and policy version that accompanied the current
-- preference change. Existing users remain unchanged/null and therefore are
-- not treated as opted in.
--
-- sms_reminder_sent_at is an atomic claim on the one DailyQueue row per
-- user/day. The cron sets it before delivery and clears it only when delivery
-- fails, preventing retry/concurrency duplicates.
--
-- Rollback:
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "sms_opt_in_at";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "sms_opt_out_at";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "sms_consent_source";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "sms_consent_policy_version";
--   ALTER TABLE "DailyQueue" DROP COLUMN IF EXISTS "sms_reminder_sent_at";

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sms_opt_in_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sms_opt_out_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sms_consent_source" text;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sms_consent_policy_version" text;
--> statement-breakpoint
ALTER TABLE "DailyQueue" ADD COLUMN IF NOT EXISTS "sms_reminder_sent_at" timestamptz;
