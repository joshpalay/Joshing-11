ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT true NOT NULL;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "llm_suggested_answer" text;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "critique_iterations" integer DEFAULT 0 NOT NULL;

UPDATE "Question" SET "verified" = true WHERE "verified" IS DISTINCT FROM true;

CREATE TABLE IF NOT EXISTS "CritiqueUsageDaily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "usage_date" date NOT NULL,
  "critique_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "CritiqueUsageDaily_user_id_usage_date_key" UNIQUE("user_id", "usage_date")
);

CREATE INDEX IF NOT EXISTS "CritiqueUsageDaily_user_id_usage_date_idx" ON "CritiqueUsageDaily" ("user_id", "usage_date");
