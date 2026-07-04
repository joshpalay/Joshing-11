-- 0112: drop KnowledgeNode.node_weight. The v2 mastery model moved from an
-- abstract 1–10 depth "weight" to a per-node POINTS threshold stored in
-- mastery_threshold (docs/thinking/MASTERY-MODEL-v2.md "Final model"), so
-- node_weight is dead — the read-model, admin editor, and seeder all use
-- mastery_threshold now.
-- Rollback: ALTER TABLE "KnowledgeNode" ADD COLUMN "node_weight" integer;
ALTER TABLE "KnowledgeNode" DROP COLUMN IF EXISTS "node_weight";
