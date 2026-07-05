-- 0115: QuestionSalvageProposal (D-QUALITY-SALVAGE-01).
--
-- Stores a machine-proposed MINIMAL fix for a verifier-demoted question — a
-- trimmed/corrected stem or explainer that has already been re-verified — so a
-- human can approve it with one click in the review queue instead of hand-editing
-- each demotion. Never applied automatically; approving copies the proposed text
-- through the normal edit/approve path. One live ('ready') proposal per question.
--
-- Purely additive: no existing table is altered. RLS enabled with no policies
-- (the app connects as the owner role, which bypasses RLS) per B-SECURITY-RLS-01
-- / migration 0081 — without it the table is reachable over Supabase's public
-- Data API. Every statement is idempotent and mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0103's CrafterDraftDecision guard).
--
-- NB: 0114 (set-completion) lands from a sibling branch; this migration is
-- independent of it (different table, no ordering dependency).
--
-- Rollback:
--   DROP TABLE IF EXISTS "QuestionSalvageProposal";
CREATE TABLE IF NOT EXISTS "QuestionSalvageProposal" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "question_id" text NOT NULL,
  "target_table" text NOT NULL,
  "kind" text NOT NULL,
  "proposed_stem" text,
  "proposed_explanation" text,
  "reverify_outcome" text NOT NULL,
  "reverify_reason" text,
  "status" text NOT NULL DEFAULT 'ready',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "QuestionSalvageProposal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "QuestionSalvageProposal_question_id_idx" ON "QuestionSalvageProposal" ("question_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "QuestionSalvageProposal_active_question_key"
  ON "QuestionSalvageProposal" ("question_id")
  WHERE "status" = 'ready';
