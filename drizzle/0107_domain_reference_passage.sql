-- 0107_domain_reference_passage (D-FANDOM-GROUNDING-01, ratified A2+B2+C+D1+E+F1)
--
-- Per-domain reference-passage cache: one row per canonical_subcategory holding a
-- canon-scoped extract retrieved from Wikipedia (primary) or Fandom (fallback for
-- deep-specialist domains), refreshed on a daily TTL (decision E). One retrieval
-- feeds two consumers: the generation prompt's reference anchor (Consumer A,
-- flag GENERATION_WIKI_ANCHOR_ENABLED, default off) and the verifier's grounding
-- posture (Consumer B, VERIFY_WEB_SEARCH_ALLOWED_DOMAINS). source='none' is a
-- negative cache (retrieval ran, neither wiki covers the domain — don't re-bill
-- until TTL lapses). Passage text is grounding-only; it is never persisted into a
-- served question (decision C — enforced by the questionLeaksPassageText guard).
-- RLS enabled per B-SECURITY-RLS-01 (no policies; owner role bypasses).
--
-- Rollback: unset GENERATION_WIKI_ANCHOR_ENABLED and VERIFY_WEB_SEARCH_ALLOWED_DOMAINS
-- (both paths revert to current behavior with no redeploy), then
-- DROP TABLE "DomainReferencePassage";
CREATE TABLE IF NOT EXISTS "DomainReferencePassage" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "canonical_subcategory" text NOT NULL,
  "source" text NOT NULL,
  "passage" text,
  "source_url" text,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "DomainReferencePassage_source_valid" CHECK (source IN ('wikipedia', 'fandom', 'none'))
);
--> statement-breakpoint
ALTER TABLE "DomainReferencePassage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DomainReferencePassage_domain_key" ON "DomainReferencePassage" ("canonical_subcategory");
