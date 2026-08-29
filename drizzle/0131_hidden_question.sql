-- HiddenQuestion: a player's permanent "never show me this question again".
--
-- The Not-for-me sheet (one control replacing the old adjacent "Dismiss" and
-- "This is {Name}'s bag but not mine" links) offers three scopes: skip for now,
-- hide this question, rest this category. The first two already had homes --
-- SkippedDailyQuestion for the temporary skip, DailyPreference.domain_preference_frequency
-- = 'resting' for the category -- but there was nowhere to record a durable
-- per-question refusal. This table is that home.
--
-- It deliberately does NOT carry a queue_id. SkippedDailyQuestion is scoped to
-- the round it happened in and cascades away with its queue; a hide is a
-- standing preference that must survive every queue it was ever served in.
--
-- Hiding is reversible: "Hidden questions" in settings lists these rows and
-- restoring one DELETES it. That reversibility is the condition under which
-- permanent hiding is safe against a finite question pool
-- (D-SUPPLY-FINITE-SET-01) -- an accidental hide is always recoverable, so no
-- question is ever burned out of the corpus for good.
--
-- Rollback: DROP TABLE "HiddenQuestion"; -- it is additive and nothing outside
-- the hide/restore path reads it, so dropping it restores prior behavior
-- exactly (every hidden question simply becomes servable again).

CREATE TABLE IF NOT EXISTS "HiddenQuestion" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "question_id" text,
  "generated_question_id" text,
  "canonical_subcategory" text NOT NULL,
  "hidden_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "HiddenQuestion" ADD CONSTRAINT "HiddenQuestion_user_id_User_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "HiddenQuestion" ADD CONSTRAINT "HiddenQuestion_question_id_Question_id_fk"
    FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "HiddenQuestion" ADD CONSTRAINT "HiddenQuestion_generated_question_id_GeneratedQuestion_id_fk"
    FOREIGN KEY ("generated_question_id") REFERENCES "public"."GeneratedQuestion"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HiddenQuestion_user_id_idx" ON "HiddenQuestion" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HiddenQuestion_user_id_question_id_idx" ON "HiddenQuestion" ("user_id","question_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HiddenQuestion_user_id_generated_question_id_idx" ON "HiddenQuestion" ("user_id","generated_question_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HiddenQuestion_question_id_idx" ON "HiddenQuestion" ("question_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HiddenQuestion_generated_question_id_idx" ON "HiddenQuestion" ("generated_question_id");
--> statement-breakpoint
-- B-SECURITY-RLS-01 (precedent: 0081_enable_rls_public_tables). A new public
-- table is reachable over the Supabase Data API by anon/authenticated the moment
-- it exists. No policies: the app connects as owner `postgres`, which bypasses RLS.
ALTER TABLE "HiddenQuestion" ENABLE ROW LEVEL SECURITY;
