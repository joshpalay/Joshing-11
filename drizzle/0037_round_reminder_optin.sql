-- Migration: opt-in plumbing for round-open reminders.
-- Phase 1 stores user preferences and a dismissal timestamp; no message is
-- sent yet. Phase 2 will add EmailVerificationToken + EmailLog tables and
-- wire the cron to actually deliver.
--
-- Idempotent guards are also pre-applied in src/instrumentation.ts for
-- preview/production databases that may have this migration recorded
-- without the columns actually present.
CREATE TYPE "public"."EmailOptIn" AS ENUM('opted_in', 'opted_out', 'not_asked');
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "email_opt_in" "public"."EmailOptIn" NOT NULL DEFAULT 'not_asked';
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "reminder_prompt_dismissed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "pending_email" text;
