-- B-LLM-PROVIDER-AB-SWITCH B2 — AppSettings single-row global settings table.
--
-- One global row (id = 'singleton', pinned by a CHECK so a second row can never
-- be inserted) holding the provider choice for each of the four LLM surfaces:
-- generation, categorization, answer-suggestion, grading. Each column is text
-- constrained to ('anthropic','openai') and defaults to 'anthropic', so the
-- table is inert at creation — every surface stays on Anthropic until the owner
-- flips a dropdown. Read through the cached getProviderSettings() helper.
--
-- Purely additive: no existing table is altered. RLS is enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table would be reachable over Supabase's
-- public Data API. Every statement is idempotent (IF NOT EXISTS, ON CONFLICT)
-- and mirrored by a defensive guard in src/instrumentation.ts (precedent: 0073)
-- so a preview/production database that records this migration without the table
-- present still boots.
--
-- Rollback:
--   DROP TABLE IF EXISTS "AppSettings";
CREATE TABLE IF NOT EXISTS "AppSettings" (
  "id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
  "gen_provider" text NOT NULL DEFAULT 'anthropic',
  "categorize_provider" text NOT NULL DEFAULT 'anthropic',
  "suggest_provider" text NOT NULL DEFAULT 'anthropic',
  "grade_provider" text NOT NULL DEFAULT 'anthropic',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "AppSettings_singleton" CHECK (id = 'singleton'),
  CONSTRAINT "AppSettings_gen_provider_valid" CHECK (gen_provider IN ('anthropic', 'openai')),
  CONSTRAINT "AppSettings_categorize_provider_valid" CHECK (categorize_provider IN ('anthropic', 'openai')),
  CONSTRAINT "AppSettings_suggest_provider_valid" CHECK (suggest_provider IN ('anthropic', 'openai')),
  CONSTRAINT "AppSettings_grade_provider_valid" CHECK (grade_provider IN ('anthropic', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "AppSettings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "AppSettings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;
