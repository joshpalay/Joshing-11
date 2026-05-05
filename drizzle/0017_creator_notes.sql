ALTER TYPE "SmsMessageType" ADD VALUE IF NOT EXISTS 'creator_note_received';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CreatorNote" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "authorUserId" text NOT NULL,
  "recipientUserId" text NOT NULL,
  "questionId" text NOT NULL,
  "contextType" text NOT NULL,
  "contextId" text,
  "noteText" text NOT NULL,
  "promptedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "writtenAt" timestamp with time zone,
  "deliveredAt" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_authorUserId_User_id_fk" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_recipientUserId_User_id_fk" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CreatorNote" ADD CONSTRAINT "CreatorNote_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CreatorNote_authorUserId_promptedAt_idx" ON "CreatorNote" USING btree ("authorUserId","promptedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CreatorNote_recipientUserId_questionId_idx" ON "CreatorNote" USING btree ("recipientUserId","questionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CreatorNote_questionId_idx" ON "CreatorNote" USING btree ("questionId");
