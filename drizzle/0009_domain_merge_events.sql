ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'domain_merged';--> statement-breakpoint
ALTER TABLE "MASTERY_EVENTS" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
