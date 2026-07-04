-- 0111: KnowledgeLeafMastery — the LEAF-mastery freeze ledger (Mastery v2,
-- docs/thinking/MASTERY-MODEL-v2.md decision 3), the grain inversion of
-- KnowledgeParentMastery. A row = the moment a player permanently mastered a
-- leaf; leaf mastery is terminal, while parent mastery is computed LIVE and never
-- frozen. New + isolated; RLS-enabled with no policies (owner role bypasses RLS)
-- per B-SECURITY-RLS-01. Dark until KNOWLEDGE_MASTERY_V2.
-- Rollback: DROP TABLE "KnowledgeLeafMastery";
CREATE TABLE IF NOT EXISTS "KnowledgeLeafMastery" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL REFERENCES "User"("id"),
  "leaf_domain_key" text NOT NULL,
  "mastered_at" timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE "KnowledgeLeafMastery" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeLeafMastery_user_leaf_key" ON "KnowledgeLeafMastery" ("user_id", "leaf_domain_key");
CREATE INDEX IF NOT EXISTS "KnowledgeLeafMastery_user_id_idx" ON "KnowledgeLeafMastery" ("user_id");
