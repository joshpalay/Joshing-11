-- B-LLM-PROVIDER-AB-METRICS (Part 3) — provider flip log.
--
-- Records every owner change to the LLM provider A/B switch, one row per surface
-- that actually changed, so the experiment's comparison windows are unambiguous:
-- you can read exactly when grading/generation/etc. flipped and back. Without
-- this, "the OpenAI window" has to be inferred from log timestamps. Append-only;
-- written best-effort from the admin PATCH route after the AppSettings write
-- succeeds (a failed log row must never block a provider change).
--
-- Purely additive: no existing table is altered. RLS is enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table would be reachable over Supabase's
-- public Data API. Every statement is idempotent and mirrored by a defensive
-- guard in src/instrumentation.ts (precedent: 0087) so a preview/production
-- database that records this migration without the table present still boots.
--
-- Rollback:
--   DROP TABLE IF EXISTS "LlmProviderChangeLog";
CREATE TABLE IF NOT EXISTS "LlmProviderChangeLog" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "surface" text NOT NULL,
  "from_provider" text NOT NULL,
  "to_provider" text NOT NULL,
  "changed_by_user_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "LlmProviderChangeLog_surface_valid" CHECK (surface IN ('gen', 'categorize', 'suggest', 'grade')),
  CONSTRAINT "LlmProviderChangeLog_from_valid" CHECK (from_provider IN ('anthropic', 'openai')),
  CONSTRAINT "LlmProviderChangeLog_to_valid" CHECK (to_provider IN ('anthropic', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "LlmProviderChangeLog" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LlmProviderChangeLog_created_at_idx" ON "LlmProviderChangeLog" ("created_at");
