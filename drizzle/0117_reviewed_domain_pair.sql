-- 0117: ReviewedDomainPair (D-DOMAIN-MERGE-REVIEW-REDESIGN-01, Part 1).
--
-- Permanent "Dismiss" record for the domain-merge review surface. When a
-- curator decides a near-duplicate pair is genuinely two different territories
-- ("a work vs its genre"), Dismiss writes one row here so the pair never
-- resurfaces on the next similarity recompute.
--
-- The primary key is ORDER-INDEPENDENT and ID-based: it is the two domains'
-- folded domain_key values sorted ascending and joined with '::' (see
-- reviewedPairKey in src/server/db/queries/domain-fragmentation.ts). Keying on
-- the folded key — not the raw label — means (A,B) and (B,A) collapse to one
-- key AND a cosmetic domain rename that folds to the same key does not
-- resurrect a dismissed pair. domain_a/domain_b keep a human-readable spelling
-- of each side at dismiss time, for debugging only — never for matching.
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table is reachable over Supabase's public
-- Data API. Every statement is idempotent and mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0116's DomainDepthEstimate guard).
--
-- Rollback:
--   DROP TABLE IF EXISTS "ReviewedDomainPair";
CREATE TABLE IF NOT EXISTS "ReviewedDomainPair" (
  "pair_key" text PRIMARY KEY NOT NULL,
  "domain_a" text NOT NULL,
  "domain_b" text NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ReviewedDomainPair" ENABLE ROW LEVEL SECURITY;
