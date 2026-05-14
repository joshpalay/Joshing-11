ALTER TABLE "Question" ALTER COLUMN "creator_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "generated_question_id" text;
--> statement-breakpoint
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'authored' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Question" ADD CONSTRAINT "Question_generated_question_id_GeneratedQuestion_id_fk" FOREIGN KEY ("generated_question_id") REFERENCES "GeneratedQuestion"("id") ON DELETE set null;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Question_generated_question_id_key" ON "Question" USING btree ("generated_question_id");
--> statement-breakpoint
ALTER TABLE "PLAYER_MASTERY" ADD COLUMN IF NOT EXISTS "territory_type" text DEFAULT 'demonstrated' NOT NULL;
--> statement-breakpoint
UPDATE "PLAYER_MASTERY" SET "territory_type" = 'demonstrated' WHERE "territory_type" IS DISTINCT FROM 'demonstrated';
