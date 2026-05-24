-- Migration: opt-in plumbing for round-open reminders.
-- Phase 1 stores user preferences and a dismissal timestamp; no message is
-- sent yet. Phase 2 will add EmailVerificationToken + EmailLog tables and
-- wire the cron to actually deliver.
--
-- Idempotent guards: CREATE TYPE has no native IF NOT EXISTS, so it is
-- wrapped in DO ... EXCEPTION WHEN duplicate_object. Mirrors
-- src/instrumentation.ts.
DO $$ BEGIN
  CREATE TYPE "public"."EmailOptIn" AS ENUM('opted_in', 'opted_out', 'not_asked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
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
