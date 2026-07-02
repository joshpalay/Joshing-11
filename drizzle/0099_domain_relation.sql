-- D-NEARNESS-LADDER-HYBRID-01 (decision B2) — the global near-ness tree cache.
--
-- Stores structural, player-independent domain relations: for a `child_domain`,
-- the `related_domain`s one step away, labeled by `rung` (sibling / cousin /
-- parent / grandparent) and tagged by `source` ('curated' | 'llm'). Computed ONCE
-- per domain by a lazy Haiku call on the shared thinness boundary and read by both
-- supply (route freed slots to held near rungs) and expansion (offer unheld near
-- rungs). One row per (child_domain, related_domain).
--
-- `rung`/`source` are plain text with CHECK constraints rather than pg enums —
-- new, small vocabularies, and CHECKs keep the idempotent boot guard trivial (no
-- CREATE TYPE / ADD VALUE dance).
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (owner role bypasses RLS) per B-SECURITY-RLS-01 / migration 0081. Every statement
-- is idempotent and mirrored by a defensive guard in src/instrumentation.ts.
--
-- Rollback:
--   DROP TABLE IF EXISTS "DomainRelation";
CREATE TABLE IF NOT EXISTS "DomainRelation" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "child_domain" text NOT NULL,
  "related_domain" text NOT NULL,
  "broad_category" text,
  "rung" text NOT NULL CHECK ("rung" IN ('sibling', 'cousin', 'parent', 'grandparent')),
  "source" text NOT NULL CHECK ("source" IN ('curated', 'llm')),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "DomainRelation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "DomainRelation_child_related_key" ON "DomainRelation" ("child_domain", "related_domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "DomainRelation_child_domain_idx" ON "DomainRelation" ("child_domain");
