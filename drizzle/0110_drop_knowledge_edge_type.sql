-- 0110: drop KnowledgeEdge.edge_type. The substantive/collection distinction is
-- removed (docs/thinking/MASTERY-MODEL-v2.md, Phase 4) — every containment edge
-- is now depth-eligible credit. Prod had 0 collection edges (audit 2026-07-03),
-- so no existing edge is reinterpreted. The application stops reading the column
-- as of this change (graph.ts / knowledge-tree.ts / knowledge-graph.ts).
-- Rollback: ALTER TABLE "KnowledgeEdge" ADD COLUMN "edge_type" text NOT NULL
--   DEFAULT 'substantive'; (every existing edge was substantive).
ALTER TABLE "KnowledgeEdge" DROP COLUMN IF EXISTS "edge_type";
