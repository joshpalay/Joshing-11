-- Add demographic context columns to User for LLM-informed interest generation
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "birth_year" INTEGER;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "grew_up_country" TEXT;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "grew_up_region" TEXT;
