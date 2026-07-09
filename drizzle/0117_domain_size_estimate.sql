-- 0117: DomainDepthEstimate corpus-grounded size columns (D-SUPPLY-FINITENESS-01).
--
-- Extends the depth cache (0116) with a CORPUS-grounded size estimate. The
-- resolver (src/server/daily/domain-size-estimate.ts) routes a domain to a real
-- Wikipedia / Wikidata / Fandom anchor, counts it shape-aware, and
-- normalizeToQuestionEstimate turns that into "estimated_questions" — the number
-- getTargetQuestionCountForDomains now PREFERS over coefficient·depth² when
-- present. The other columns record the resolution (shape, anchors, confidence,
-- basis) for the coverage dashboard + the confidence-gated discrepancy alarm.
--
-- Purely additive: every column is nullable and idempotent (ADD COLUMN IF NOT
-- EXISTS). A row with these NULL falls back to the depth-derived count exactly as
-- before, so it is safe to record ahead of any backfill. Mirrored by a defensive
-- guard in src/instrumentation.ts (same rationale as the 0116 guard).
--
-- Rollback:
--   ALTER TABLE "DomainDepthEstimate"
--     DROP COLUMN IF EXISTS "estimated_questions", DROP COLUMN IF EXISTS "corpus_count",
--     DROP COLUMN IF EXISTS "shape", DROP COLUMN IF EXISTS "confidence",
--     DROP COLUMN IF EXISTS "basis", DROP COLUMN IF EXISTS "wikipedia_title",
--     DROP COLUMN IF EXISTS "wikidata_qid", DROP COLUMN IF EXISTS "fandom_host",
--     DROP COLUMN IF EXISTS "resolved_at";
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "estimated_questions" integer;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "corpus_count" integer;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "shape" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "confidence" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "basis" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "wikipedia_title" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "wikidata_qid" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "fandom_host" text;
--> statement-breakpoint
ALTER TABLE "DomainDepthEstimate" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
