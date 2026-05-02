ALTER TYPE "public"."MasterySourceType" ADD VALUE IF NOT EXISTS 'curator_credit';--> statement-breakpoint
ALTER TABLE "UserQuestionBank" ADD COLUMN IF NOT EXISTS "added_from_context_type" text;--> statement-breakpoint
ALTER TABLE "UserQuestionBank" ADD COLUMN IF NOT EXISTS "added_from_context_id" text;
