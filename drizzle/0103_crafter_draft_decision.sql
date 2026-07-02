-- 0103_crafter_draft_decision (B-CRAFTER-DECISION-LEDGER-01)
--
-- The crafter surface's teaching ledger: one row per keep/kill verdict a human
-- passes on a machine draft candidate. Until now a kill existed only as client
-- state ("an unkept candidate never existed server-side"), so the strongest
-- teaching signal — what the human rejected — evaporated in the browser. This
-- table records both verdicts durably so the draft prompt can show the model
-- the human's bar (kept exemplars / killed anti-exemplars) and so the machine's
-- own doubts (flags jsonb, the DraftFlag[] shown at decision time) can later be
-- graded against the human verdicts. Append-only teaching data: never served,
-- never joined into play paths. question_id links a keep to the Question it
-- created; edited_answer is set when the keeper corrected the machine's answer.
--
-- Plain-text CHECK vocabularies, not pg enums (0099 rationale: additive vocab
-- changes without ALTER TYPE ceremonies). RLS enabled with no policies per
-- B-SECURITY-RLS-01 / migration 0081 (owner-role app connection bypasses RLS).
-- Idempotent; mirrored by a guard in src/instrumentation.ts.
--
-- Rollback:
--   DROP TABLE IF EXISTS "CrafterDraftDecision";
CREATE TABLE IF NOT EXISTS "CrafterDraftDecision" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "decider_id" text NOT NULL REFERENCES "User"("id"),
  "domain" text NOT NULL,
  "tier" text NOT NULL CHECK ("tier" IN ('shallow', 'deep')),
  "question_text" text NOT NULL,
  "answer" text NOT NULL,
  "decision" text NOT NULL CHECK ("decision" IN ('kept', 'killed')),
  "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "edited_answer" text,
  "question_id" text REFERENCES "Question"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "CrafterDraftDecision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CrafterDraftDecision_domain_idx" ON "CrafterDraftDecision" ("domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "CrafterDraftDecision_decider_id_idx" ON "CrafterDraftDecision" ("decider_id");
