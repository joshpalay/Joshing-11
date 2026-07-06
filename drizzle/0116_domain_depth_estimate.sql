-- 0116: DomainDepthEstimate (D-DIFFICULTY-SIZE-COMPLETION-01).
--
-- Caches the LLM/Wikidata DEPTH SCORE (1-10) for a topic, keyed on its folded
-- domain_key so it covers every played canonical_subcategory (not just the few
-- authored KnowledgeNodes). Set-completion derives a depth-sized TARGET QUESTION
-- COUNT from this at read time (count = coefficient x depth^2, env-tunable), so
-- bumping the target curve later is a config change with no re-seed.
--
-- One row per domain_key. depth_score NULL is a negative cache: sizing ran and
-- the LLM returned nothing, so readers fall back to the default depth without
-- re-billing until a deliberate re-score. Cheap (one Haiku call per topic ever,
-- gated behind "player answered >= floor distinct in the domain").
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table is reachable over Supabase's public
-- Data API. Every statement is idempotent and mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0108's DomainReferencePassage guard).
--
-- Rollback:
--   DROP TABLE IF EXISTS "DomainDepthEstimate";
CREATE TABLE IF NOT EXISTS "DomainDepthEstimate" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "domain_key" text NOT NULL,
  "depth_score" integer,
  "sample_label" text,
  "source" text NOT NULL DEFAULT 'llm',
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DomainDepthEstimate_domain_key" ON "DomainDepthEstimate" ("domain_key");
