-- 0104_knowledge_parent_mastery (B-KNOWLEDGE-TAXONOMY-01 P4)
--
-- The freeze ledger for parent-grain mastery (D-doc §B): the moment a player
-- crosses a substantive parent's bar (points ≥ threshold AND ≥2 corners lit,
-- §9-A), a row is stamped here and mastery is TERMINAL — roster growth or a
-- threshold edit can never re-open it (§5 non-revocation, as durable state
-- rather than recomputation). Parent mastery is otherwise derived at read
-- time; this table stores only the crossing, never progress.
--
-- Purely additive; RLS enabled no-policy per B-SECURITY-RLS-01; idempotent and
-- mirrored by a guard in src/instrumentation.ts. Dark until
-- KNOWLEDGE_GRAPH_MASTERY flips.
--
-- Rollback:
--   DROP TABLE IF EXISTS "KnowledgeParentMastery";
CREATE TABLE IF NOT EXISTS "KnowledgeParentMastery" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id"),
  "parent_domain_key" text NOT NULL,
  "mastered_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "KnowledgeParentMastery" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeParentMastery_user_parent_key"
  ON "KnowledgeParentMastery" ("user_id", "parent_domain_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "KnowledgeParentMastery_user_id_idx" ON "KnowledgeParentMastery" ("user_id");
