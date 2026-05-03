-- Add source_result column to FeedItem (friend's result when they answered)
ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "sourceResult" TEXT;
--> statement-breakpoint
-- Add surface_priority_score to Question (aggregated thumbs-up quality signal)
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "surface_priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Create FeedDismissedDomain table for "Not my focus" domain-level dismissals
CREATE TABLE IF NOT EXISTS "FeedDismissedDomain" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "canonicalSubcategory" TEXT NOT NULL,
  "dismissedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reinstatedAt" TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_idx" ON "FeedDismissedDomain" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "FeedDismissedDomain_userId_sub_idx" ON "FeedDismissedDomain" ("userId", "canonicalSubcategory");
--> statement-breakpoint
-- Add friend_answered_question to SmsMessageType enum
ALTER TYPE "SmsMessageType" ADD VALUE IF NOT EXISTS 'friend_answered_question';
