ALTER TYPE "public"."Category" ADD VALUE IF NOT EXISTS 'general_knowledge';--> statement-breakpoint
ALTER TABLE "Question" ALTER COLUMN "category" SET DEFAULT 'general_knowledge';--> statement-breakpoint
UPDATE "Question" SET "category" = 'general_knowledge' WHERE "category" = 'other';
